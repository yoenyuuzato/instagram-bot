import { and, count, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, contacts, eventsLog, rules, type Account, type Contact, type Rule } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import * as ig from "@/lib/instagram";
import { generateReply, type ChatTurn } from "@/lib/ai/gemini";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { findMatchingRule } from "./match";
import { fillTemplate as fill } from "./template";
import { isWithinDmWindow, isWithinPrivateReplyWindow } from "./window";
import type { ActionResult, AiInfo, CommentChangeValue, EventResult, MessagingEvent, WebhookPayload } from "./types";

/** Limity AI odpovědí na jeden kontakt. */
export const AI_MIN_INTERVAL_MS = 10_000;
export const AI_MAX_PER_HOUR = 30;
/** Kolik posledních zpráv konverzace jde do kontextu AI. */
const AI_HISTORY_LIMIT = 6;

export type ProcessOptions = {
  /** Simulace z adminu – vždy mock, v logu označeno. */
  simulated?: boolean;
  /** Simulace: AI odpověď i u účtu, který má AI vypnuté. */
  forceAi?: boolean;
  now?: Date;
};

type Ctx = ProcessOptions & { now: Date };

export async function processWebhookPayload(payload: WebhookPayload, options: ProcessOptions = {}) {
  const ctx: Ctx = { ...options, now: options.now ?? new Date() };
  const results: EventResult[] = [];
  if (payload?.object !== "instagram" || !Array.isArray(payload.entry)) return results;

  for (const entry of payload.entry) {
    const account = await findAccount(entry.id);
    const entryTime = toDate(entry.time, ctx.now);

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments" || !change.value?.id) continue;
      results.push(await handleComment(account, entry.id, change.value, entryTime, ctx));
    }
    for (const msg of entry.messaging ?? []) {
      if (!msg.message?.mid) continue;
      results.push(await handleMessage(account, entry.id, msg, ctx));
    }
  }
  return results;
}

// ---------------------------------------------------------------------------

async function handleComment(
  account: Account | null,
  accountIgId: string,
  value: CommentChangeValue,
  createdAt: Date,
  ctx: Ctx,
): Promise<EventResult> {
  const text = value.text ?? "";
  const base = { kind: "comment" as const, igObjectId: value.id, accountIgId, text, actions: [] as ActionResult[] };

  const inId = await logIncoming({
    account,
    kind: "comment",
    dedupKey: `in:comment:${value.id}`,
    igObjectId: value.id,
    contactIgId: value.from?.id ?? null,
    text,
    payload: value,
    ctx,
  });
  if (inId === null) return { ...base, status: "duplicate", reason: "Komentář už byl zpracován" };

  const ignore = async (reason: string) => {
    await finishIncoming(inId, "ignored", reason);
    return { ...base, status: "ignored" as const, reason };
  };

  if (!account) return ignore("Neznámý nebo neaktivní účet");
  if (!value.from?.id) return ignore("Komentář bez autora");
  // Ochrana proti smyčce – vlastní komentáře/odpovědi účtu ignorujeme.
  if (value.from.id === account.igUserId) return ignore("Komentář od vlastního účtu");

  await upsertContact(account.id, value.from.id, value.from.username ?? null, null);

  const rule = findMatchingRule(await loadRules(account.id, "comment"), {
    type: "comment",
    text,
    postId: value.media?.id ?? null,
  });
  if (!rule) return ignore("Žádné pravidlo neodpovídá");

  const opts = { accessToken: tokenFor(account, ctx), forceMock: ctx.simulated };
  const vars = { username: value.from.username ?? "" };
  const actions: ActionResult[] = [];

  if (rule.publicReply?.trim()) {
    const msg = fill(rule.publicReply, vars);
    actions.push(
      await sendOnce(account, rule, "public_reply", `out:public_reply:${value.id}`, value.id, value.from.id, msg, ctx, () =>
        ig.replyToComment(value.id, msg, opts),
      ),
    );
  }

  if (rule.dmText?.trim()) {
    const msg = fill(rule.dmText, vars);
    if (!isWithinPrivateReplyWindow(createdAt, ctx.now)) {
      actions.push(await logSkipped(account, rule, "private_reply", value.id, value.from.id, msg, "Komentář je starší než 7 dní", ctx));
    } else {
      actions.push(
        await sendOnce(account, rule, "private_reply", `out:private_reply:${value.id}`, value.id, value.from.id, msg, ctx, () =>
          ig.sendPrivateReply(account.igUserId, value.id, { text: msg, buttonUrl: rule.dmButtonUrl, buttonTitle: rule.dmButtonTitle }, opts),
        ),
      );
    }
  }

  await finishIncoming(inId, "processed", null, rule.id);
  return { ...base, status: "processed", ruleId: rule.id, ruleName: rule.name, actions };
}

async function handleMessage(account: Account | null, accountIgId: string, msg: MessagingEvent, ctx: Ctx): Promise<EventResult> {
  const message = msg.message!;
  const text = message.text ?? "";
  const base = { kind: "message" as const, igObjectId: message.mid, accountIgId, text, actions: [] as ActionResult[] };

  // Echo = zpráva odeslaná samotným účtem (i naším botem) – nelogujeme, jen ignorujeme.
  if (message.is_echo || msg.sender.id === accountIgId) {
    return { ...base, status: "ignored", reason: "Echo vlastní zprávy" };
  }

  const inId = await logIncoming({
    account,
    kind: "message",
    dedupKey: `in:message:${message.mid}`,
    igObjectId: message.mid,
    contactIgId: msg.sender.id,
    text,
    payload: msg,
    ctx,
  });
  if (inId === null) return { ...base, status: "duplicate", reason: "Zpráva už byla zpracována" };

  const ignore = async (reason: string) => {
    await finishIncoming(inId, "ignored", reason);
    return { ...base, status: "ignored" as const, reason };
  };

  if (!account) return ignore("Neznámý nebo neaktivní účet");
  if (message.is_deleted || !text) return ignore("Zpráva bez textu");

  // Příchozí DM otevírá (prodlužuje) 24h okno.
  const contact = await upsertContact(account.id, msg.sender.id, null, toDate(msg.timestamp, ctx.now));

  // Klíčová pravidla mají přednost, AI odpovídá jen na zbytek.
  const rule = findMatchingRule(await loadRules(account.id, "dm"), { type: "dm", text });
  if (!rule) {
    if (!account.aiEnabled && !ctx.forceAi) return ignore("Žádné pravidlo neodpovídá");
    const action = await aiReply(account, contact, message.mid, ctx);
    await finishIncoming(inId, "processed", "Bez pravidla → AI");
    return { ...base, status: "processed", ruleName: "AI odpověď", actions: [action] };
  }

  const actions: ActionResult[] = [];
  if (rule.dmText?.trim()) {
    const out = fill(rule.dmText, { username: contact.username ?? "" });
    if (!isWithinDmWindow(contact.lastInteractionAt, ctx.now)) {
      actions.push(await logSkipped(account, rule, "dm", message.mid, msg.sender.id, out, "Mimo 24h okno", ctx));
    } else {
      const opts = { accessToken: tokenFor(account, ctx), forceMock: ctx.simulated };
      actions.push(
        await sendOnce(account, rule, "dm", `out:dm:${message.mid}`, message.mid, msg.sender.id, out, ctx, () =>
          ig.sendDirectMessage(account.igUserId, msg.sender.id, { text: out, buttonUrl: rule.dmButtonUrl, buttonTitle: rule.dmButtonTitle }, opts),
        ),
      );
    }
  }

  await finishIncoming(inId, "processed", null, rule.id);
  return { ...base, status: "processed", ruleId: rule.id, ruleName: rule.name, actions };
}

/**
 * AI odpověď na DM bez pravidla: 24h okno → dedup claim → rate limit → Gemini → odeslání.
 * Když AI selže, pošle se `ai_fallback_text` (pokud je vyplněný), jinak nic.
 */
async function aiReply(account: Account, contact: Contact, mid: string, ctx: Ctx): Promise<ActionResult> {
  const kind = "ai_reply" as const;
  const contactIgId = contact.igScopedId;
  if (!isWithinDmWindow(contact.lastInteractionAt, ctx.now)) {
    return logSkipped(account, null, kind, mid, contactIgId, "", "Mimo 24h okno", ctx);
  }

  const db = getDb();
  const [claim] = await db
    .insert(eventsLog)
    .values({
      accountId: account.id,
      direction: "out",
      kind,
      status: "pending",
      dedupKey: `out:${kind}:${mid}`,
      igObjectId: mid,
      contactIgId,
      simulated: !!ctx.simulated,
    })
    .onConflictDoNothing({ target: eventsLog.dedupKey })
    .returning({ id: eventsLog.id });
  if (!claim) return { kind, status: "skipped", text: "", detail: "Už odesláno (dedup)" };

  const finish = async (status: "sent" | "failed" | "skipped", text: string, detail: string, payload?: unknown) => {
    await db
      .update(eventsLog)
      .set({ status, text, detail, payload: payload ?? null })
      .where(eq(eventsLog.id, claim.id));
    return { status, text, detail };
  };

  // Rate limit – počítají se jen dřív založené AI odpovědi témuž kontaktu (při souběhu vyhraje starší).
  const sameContact = and(
    eq(eventsLog.accountId, account.id),
    eq(eventsLog.contactIgId, contactIgId),
    eq(eventsLog.kind, kind),
    eq(eventsLog.simulated, !!ctx.simulated),
    inArray(eventsLog.status, ["pending", "sent"]),
    lt(eventsLog.id, claim.id),
  );
  const [usage] = await db
    .select({
      lastHour: count(),
      recent: sql<number>`count(*) filter (where ${gt(eventsLog.createdAt, new Date(ctx.now.getTime() - AI_MIN_INTERVAL_MS))})`.mapWith(Number),
    })
    .from(eventsLog)
    .where(and(sameContact, gt(eventsLog.createdAt, new Date(ctx.now.getTime() - 3600_000))));
  if (usage.recent > 0) {
    return { kind, ...(await finish("skipped", "", `Rate limit: max 1 AI odpověď za ${AI_MIN_INTERVAL_MS / 1000} s`)) };
  }
  if (usage.lastHour >= AI_MAX_PER_HOUR) {
    return { kind, ...(await finish("skipped", "", `Rate limit: max ${AI_MAX_PER_HOUR} AI odpovědí za hodinu`)) };
  }

  const history = await loadConversation(account.id, contactIgId, ctx);
  const res = await generateReply(account.aiSystemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT, history, account.knowledgeText);
  const ai: AiInfo = { model: res.model, latencyMs: res.latencyMs, attempts: res.attempts, error: res.error };
  const aiDetail = [`${res.model} · ${res.latencyMs} ms · pokusů ${res.attempts}`, res.error && `AI chyba: ${res.error}`];

  let text = res.text ?? "";
  if (!res.ok) {
    const fallback = account.aiFallbackText?.trim();
    if (!fallback) return { kind, ai, ...(await finish("failed", "", [...aiDetail, "bez fallbacku"].filter(Boolean).join(" · "), { ai })) };
    text = fill(fallback, { username: contact.username ?? "" });
    ai.fallback = true;
    aiDetail.push("→ fallback");
  }

  const sent = await ig.sendDirectMessage(account.igUserId, contactIgId, { text }, { accessToken: tokenFor(account, ctx), forceMock: ctx.simulated });
  const detail = [...aiDetail, sent.ok ? `${sent.mock ? "MOCK " : ""}id=${sent.id}` : `IG chyba: ${sent.error}`].filter(Boolean).join(" · ");
  const out = await finish(sent.ok ? "sent" : "failed", text, detail, { request: sent.request, ai });
  return { kind, ...out, request: sent.request, mock: sent.mock, ai };
}

/** Posledních N zpráv konverzace s kontaktem (příchozí DM + úspěšně odeslané odpovědi), od nejstarší. */
async function loadConversation(accountId: number, contactIgId: string, ctx: Ctx): Promise<ChatTurn[]> {
  const rows = await getDb()
    .select({ direction: eventsLog.direction, text: eventsLog.text })
    .from(eventsLog)
    .where(
      and(
        eq(eventsLog.accountId, accountId),
        eq(eventsLog.contactIgId, contactIgId),
        eq(eventsLog.simulated, !!ctx.simulated),
        or(
          and(eq(eventsLog.direction, "in"), eq(eventsLog.kind, "message")),
          and(
            eq(eventsLog.direction, "out"),
            inArray(eventsLog.kind, ["dm", "private_reply", "ai_reply"]),
            eq(eventsLog.status, "sent"),
          ),
        ),
      ),
    )
    .orderBy(desc(eventsLog.createdAt), desc(eventsLog.id))
    .limit(AI_HISTORY_LIMIT);
  return rows.reverse().map((r) => ({ role: r.direction === "in" ? "user" : "model", text: r.text ?? "" }));
}

// ---------------------------------------------------------------------------

async function findAccount(igUserId: string) {
  const [row] = await getDb().select().from(accounts).where(eq(accounts.igUserId, igUserId)).limit(1);
  return row && row.active ? row : null;
}

function loadRules(accountId: number, triggerType: "comment" | "dm") {
  return getDb()
    .select()
    .from(rules)
    .where(and(eq(rules.accountId, accountId), eq(rules.triggerType, triggerType), eq(rules.active, true)));
}

async function upsertContact(accountId: number, igScopedId: string, username: string | null, interactionAt: Date | null) {
  const [row] = await getDb()
    .insert(contacts)
    .values({ accountId, igScopedId, username, lastInteractionAt: interactionAt })
    .onConflictDoUpdate({
      target: [contacts.accountId, contacts.igScopedId],
      set: {
        username: sql`coalesce(excluded.username, ${contacts.username})`,
        lastInteractionAt: sql`greatest(excluded.last_interaction_at, ${contacts.lastInteractionAt})`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row;
}

async function logIncoming(p: {
  account: Account | null;
  kind: "comment" | "message";
  dedupKey: string;
  igObjectId: string;
  contactIgId: string | null;
  text: string;
  payload: unknown;
  ctx: Ctx;
}) {
  const [row] = await getDb()
    .insert(eventsLog)
    .values({
      accountId: p.account?.id ?? null,
      direction: "in",
      kind: p.kind,
      status: "received",
      dedupKey: p.dedupKey,
      igObjectId: p.igObjectId,
      contactIgId: p.contactIgId,
      text: p.text,
      payload: p.payload,
      simulated: !!p.ctx.simulated,
    })
    .onConflictDoNothing({ target: eventsLog.dedupKey })
    .returning({ id: eventsLog.id });
  return row?.id ?? null;
}

async function finishIncoming(id: number, status: "processed" | "ignored", detail: string | null, ruleId?: number) {
  await getDb().update(eventsLog).set({ status, detail, ruleId: ruleId ?? null }).where(eq(eventsLog.id, id));
}

/** Idempotentní odeslání: nejdřív "claim" řádku s unikátním dedup klíčem, pak volání API. */
async function sendOnce(
  account: Account,
  rule: Rule | null,
  kind: ActionResult["kind"],
  dedupKey: string,
  igObjectId: string,
  contactIgId: string,
  text: string,
  ctx: Ctx,
  send: () => Promise<ig.GraphResult>,
): Promise<ActionResult> {
  const db = getDb();
  const [claim] = await db
    .insert(eventsLog)
    .values({
      accountId: account.id,
      ruleId: rule?.id ?? null,
      direction: "out",
      kind,
      status: "pending",
      dedupKey,
      igObjectId,
      contactIgId,
      text,
      simulated: !!ctx.simulated,
    })
    .onConflictDoNothing({ target: eventsLog.dedupKey })
    .returning({ id: eventsLog.id });
  if (!claim) return { kind, status: "skipped", text, detail: "Už odesláno (dedup)" };

  const res = await send();
  const status = res.ok ? "sent" : "failed";
  const detail = res.ok ? `${res.mock ? "MOCK " : ""}id=${res.id}` : res.error;
  await db
    .update(eventsLog)
    .set({ status, detail, payload: res.request })
    .where(eq(eventsLog.id, claim.id));
  return { kind, status, text, detail, request: res.request, mock: res.mock };
}

async function logSkipped(
  account: Account,
  rule: Rule | null,
  kind: ActionResult["kind"],
  igObjectId: string,
  contactIgId: string,
  text: string,
  reason: string,
  ctx: Ctx,
): Promise<ActionResult> {
  await getDb().insert(eventsLog).values({
    accountId: account.id,
    ruleId: rule?.id ?? null,
    direction: "out",
    kind,
    status: "skipped",
    igObjectId,
    contactIgId,
    text,
    detail: reason,
    simulated: !!ctx.simulated,
  });
  return { kind, status: "skipped", text, detail: reason };
}

function tokenFor(account: Account, ctx: Ctx) {
  if (ctx.simulated || env.instagramMock || !account.accessToken) return null;
  return decrypt(account.accessToken);
}


/** Meta posílá čas v sekundách i v milisekundách podle typu události. */
function toDate(t: number | undefined, fallback: Date) {
  if (!t) return fallback;
  return new Date(t < 1e12 ? t * 1000 : t);
}
