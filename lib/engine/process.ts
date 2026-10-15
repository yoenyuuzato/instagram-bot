import { and, count, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, contacts, eventsLog, rules, type Account, type Contact, type Rule } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import * as ig from "@/lib/instagram";
import { generateReply, type ChatTurn } from "@/lib/ai/gemini";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { detectContacts, type ContactHit } from "@/lib/notify/detect";
import { buildLeadEmail, buildRuleEmail, contactDisplay, sendEmail } from "@/lib/notify/email";
import { sendTokenAlert } from "@/lib/tokens/service";
import { findMatchingRule } from "./match";
import { fillTemplate as fill } from "./template";
import { isBotEcho, isBotPaused, nextPauseState, parseHumanCommand, PAUSE_LOG_DETAIL } from "./takeover";
import { sleep, typingDelayMs } from "./typing";
import { isWithinDmWindow, isWithinPrivateReplyWindow } from "./window";
import type { ActionResult, AiInfo, CommentChangeValue, EventResult, MessagingEvent, WebhookPayload } from "./types";

/** Limity AI odpovědí na jeden kontakt. */
export const AI_MIN_INTERVAL_MS = 10_000;
export const AI_MAX_PER_HOUR = 30;
/** Upozornění na spuštěné pravidlo max. 1× za tuto dobu na kontakt + pravidlo. */
export const RULE_NOTIFY_WINDOW_MS = 12 * 3600_000;
/** Kolik posledních zpráv konverzace jde do kontextu AI. */
const AI_HISTORY_LIMIT = 6;

export type ProcessOptions = {
  /** Simulace z adminu – vždy mock, v logu označeno. */
  simulated?: boolean;
  /** Simulace: AI odpověď i u účtu, který má AI vypnuté. */
  forceAi?: boolean;
  now?: Date;
};

type Ctx = ProcessOptions & {
  now: Date;
  /** Úlohy, které nesmí zdržet odpovědi (upozornění na leady) – spustí se až po zpracování celého payloadu. */
  deferred: (() => Promise<void>)[];
};

export async function processWebhookPayload(payload: WebhookPayload, options: ProcessOptions = {}) {
  const ctx: Ctx = { ...options, now: options.now ?? new Date(), deferred: [] };
  const results: EventResult[] = [];
  if (payload?.object !== "instagram" || !Array.isArray(payload.entry)) return results;

  for (const entry of payload.entry) {
    const account = await findAccount(entry.id);
    const entryTime = toDate(entry.time, ctx.now);

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments" || !change.value?.id) continue;
      results.push(await handleComment(account, entry.id, change.value, entryTime, ctx));
    }
    for (const raw of entry.messaging ?? []) {
      const msg = asMessage(raw);
      if (!msg) continue;
      results.push(await handleMessage(account, entry.id, msg, ctx));
    }
  }

  // Až po odeslání všech odpovědí (webhook celé zpracování spouští v after()).
  for (const task of ctx.deferred) {
    try {
      await task();
    } catch (e) {
      console.error("[engine] odložená úloha selhala", e);
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

/**
 * Klik na ice breaker (postback) a quick reply se zpracují jako běžná zpráva s textem z payloadu
 * (payload nastavujeme na text tlačítka/otázky).
 */
export function asMessage(msg: MessagingEvent): MessagingEvent | null {
  if (msg.message?.mid) return msg;
  const pb = msg.postback;
  const text = pb?.payload || pb?.title;
  if (!pb || !text) return null;
  return { ...msg, message: { mid: pb.mid ?? `postback_${msg.sender.id}_${msg.timestamp}`, text } };
}

async function handleMessage(account: Account | null, accountIgId: string, msg: MessagingEvent, ctx: Ctx): Promise<EventResult> {
  const message = msg.message!;
  const text = message.quick_reply?.payload || message.text || "";
  const base = { kind: "message" as const, igObjectId: message.mid, accountIgId, text, actions: [] as ActionResult[] };

  // Echo = zpráva odeslaná samotným účtem – botem, nebo ručně člověkem (→ pauza bota u kontaktu).
  if (message.is_echo || msg.sender.id === accountIgId) {
    return handleEcho(account, msg, base, ctx);
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

  // Upozornění e-mailem (jen ostré zprávy, odesílá se až po odpovědích): lead (e-mail/telefon ve zprávě) má přednost,
  // jinak pravidlo s notify_on_match. Pravidlo a odpověď se doplní níž, úloha je čte až při spuštění.
  const notifyTo = account.notifyEmail?.trim();
  const matched: { rule: Rule | null; reply: ActionResult | null } = { rule: null, reply: null };
  if (notifyTo && !ctx.simulated) {
    const hits = detectContacts(text);
    const at = toDate(msg.timestamp, ctx.now);
    const n = { account, contact, mid: message.mid, text, to: notifyTo, at };
    ctx.deferred.push(async () => {
      if (hits.length && (await notifyLead(n, hits, ctx))) return;
      if (matched.rule?.notifyOnMatch) await notifyRule(n, matched.rule, matched.reply, ctx);
    });
  }

  // Ruční převzetí – odpovídá člověk, bot mlčí (upozornění na leady výše běží dál).
  if (isBotPaused(contact, ctx.now)) return ignore(PAUSE_LOG_DETAIL);

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
      const content = { text: out, buttonUrl: rule.dmButtonUrl, buttonTitle: rule.dmButtonTitle, quickReplies: rule.quickReplies };
      actions.push(
        await sendOnce(account, rule, "dm", `out:dm:${message.mid}`, message.mid, msg.sender.id, out, ctx, async () => {
          await (await startTyping(account, msg.sender.id, ctx))(out);
          return ig.sendDirectMessage(account.igUserId, msg.sender.id, content, opts);
        }),
      );
    }
  }

  matched.rule = rule;
  matched.reply = actions[0] ?? null;
  await finishIncoming(inId, "processed", null, rule.id);
  return { ...base, status: "processed", ruleId: rule.id, ruleName: rule.name, actions };
}

/**
 * Echo zprávy z našeho účtu. Botovy zprávy (mid uložený při odeslání) se ignorují. Ruční zpráva člověka
 * pozastaví bota u kontaktu na accounts.human_pause_minutes; příkazy #bot / #stop pauzu zruší / nastaví natrvalo.
 * Ruční zprávy se logují jako `human_reply` (běžné jako "sent" → jdou do historie pro AI, příkazy jako "processed").
 */
async function handleEcho(account: Account | null, msg: MessagingEvent, base: Omit<EventResult, "status">, ctx: Ctx): Promise<EventResult> {
  const ignored = (reason: string): EventResult => ({ ...base, status: "ignored", reason });
  const message = msg.message!;
  const contactIgId = msg.recipient?.id;
  if (!account || ctx.simulated) return ignored("Echo vlastní zprávy");
  if (!contactIgId || contactIgId === account.igUserId) return ignored("Echo zprávy sobě");
  if (message.is_deleted) return ignored("Echo smazané zprávy");

  const db = getDb();
  const sentByBot = await isBotEcho({
    isSentByBot: async () => {
      const [row] = await db
        .select({ id: eventsLog.id })
        .from(eventsLog)
        .where(and(eq(eventsLog.accountId, account.id), eq(eventsLog.igMessageId, message.mid)))
        .limit(1);
      return !!row;
    },
    hasPendingSend: async () => {
      const [row] = await db
        .select({ id: eventsLog.id })
        .from(eventsLog)
        .where(
          and(
            eq(eventsLog.accountId, account.id),
            eq(eventsLog.contactIgId, contactIgId),
            eq(eventsLog.direction, "out"),
            inArray(eventsLog.kind, ["dm", "private_reply", "ai_reply"]),
            eq(eventsLog.status, "pending"),
            eq(eventsLog.simulated, false),
            gt(eventsLog.createdAt, new Date(Date.now() - 120_000)),
          ),
        )
        .limit(1);
      return !!row;
    },
    sleep,
  });
  if (sentByBot) return ignored("Echo zprávy bota");

  const command = parseHumanCommand(message.text);
  const [claim] = await db
    .insert(eventsLog)
    .values({
      accountId: account.id,
      direction: "out",
      kind: "human_reply",
      status: command ? "processed" : "sent",
      dedupKey: `echo:${message.mid}`,
      igObjectId: message.mid,
      igMessageId: message.mid,
      contactIgId,
      text: message.text ?? "",
      payload: msg,
    })
    .onConflictDoNothing({ target: eventsLog.dedupKey })
    .returning({ id: eventsLog.id });
  if (!claim) return { ...base, status: "duplicate", reason: "Echo už bylo zpracováno" };

  const contact = await upsertContact(account.id, contactIgId, null, null);
  const next = nextPauseState(contact, command, account.humanPauseMinutes, ctx.now);
  if (next) {
    await db
      .update(contacts)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(contacts.id, contact.id));
  }
  const state = next ?? contact;
  const detail =
    command === "resume"
      ? "#bot – pauza zrušena, bot odpovídá"
      : state.botPausedPermanent
        ? `${command === "stop" ? "#stop – " : "Ruční odpověď – "}bot pozastaven natrvalo`
        : state.botPausedUntil && state.botPausedUntil > ctx.now
          ? `Ruční odpověď – bot pozastaven do ${formatPragueTime(state.botPausedUntil)}`
          : "Ruční odpověď – automatická pauza je vypnutá";
  await db.update(eventsLog).set({ detail }).where(eq(eventsLog.id, claim.id));
  return { ...base, status: "processed", reason: detail };
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

  const finish = async (status: "sent" | "failed" | "skipped", text: string, detail: string, payload?: unknown, igMessageId: string | null = null) => {
    await db
      .update(eventsLog)
      .set({ status, text, detail, payload: payload ?? null, igMessageId })
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

  // "Píše…" už během generování; před odesláním se dočká do typingDelayMs od začátku.
  const typing = await startTyping(account, contactIgId, ctx);
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

  await typing(text);
  const sent = await ig.sendDirectMessage(account.igUserId, contactIgId, { text }, { accessToken: tokenFor(account, ctx), forceMock: ctx.simulated });
  watchToken(account, sent, ctx);
  const detail = [...aiDetail, sent.ok ? `${sent.mock ? "MOCK " : ""}id=${sent.id}` : `IG chyba: ${sent.error}`].filter(Boolean).join(" · ");
  const out = await finish(sent.ok ? "sent" : "failed", text, detail, { request: sent.request, ai }, sentMid(kind, sent));
  return { kind, ...out, request: sent.request, mock: sent.mock, ai };
}

type NotifyInput = { account: Account; contact: Contact; mid: string; text: string; to: string; at: Date };

/**
 * Upozornění na lead e-mailem. Dedup: 1× na kontakt + hodnotu (řádek `lead_notify` s dedup klíčem).
 * Když odeslání selže, dedup klíč se uvolní, takže se to zkusí znovu při další zprávě se stejným údajem.
 * Vrací true, když se o odeslání pokusilo (pak už se neposílá upozornění na pravidlo).
 */
async function notifyLead({ account, contact, mid, text, to, at }: NotifyInput, hits: ContactHit[], ctx: Ctx) {
  const db = getDb();
  const claimed: { hit: ContactHit; id: number }[] = [];
  for (const hit of hits) {
    const [row] = await db
      .insert(eventsLog)
      .values({
        accountId: account.id,
        direction: "out",
        kind: "lead_notify",
        status: "pending",
        dedupKey: `lead_notify:${account.id}:${contact.igScopedId}:${hit.value}`,
        igObjectId: mid,
        contactIgId: contact.igScopedId,
        text: hit.value,
      })
      .onConflictDoNothing({ target: eventsLog.dedupKey })
      .returning({ id: eventsLog.id });
    if (row) claimed.push({ hit, id: row.id });
  }
  if (!claimed.length) return false;

  const history = await loadConversation(account.id, contact.igScopedId, ctx);
  const res = await sendEmail(
    buildLeadEmail({
      to,
      accountUsername: account.username,
      contact: contactDisplay(contact.username, contact.igScopedId),
      hits: claimed.map((c) => c.hit),
      message: text,
      history,
      at,
    }),
  );
  await db
    .update(eventsLog)
    .set({
      status: res.ok ? "sent" : res.skipped ? "skipped" : "failed",
      detail: `→ ${to} · ${res.ok ? `Resend id=${res.id}` : res.error}`,
      ...(res.ok ? {} : { dedupKey: null }),
    })
    .where(inArray(eventsLog.id, claimed.map((c) => c.id)));
  return true;
}

/**
 * Upozornění na spuštěné pravidlo (notify_on_match). Max. 1× za RULE_NOTIFY_WINDOW_MS na kontakt + pravidlo,
 * aby "záchytné" pravidlo nespamovalo. Řádek `rule_notify` se založí hned; při souběhu vyhraje dřívější.
 */
async function notifyRule(
  { account, contact, mid, text, to, at }: NotifyInput,
  rule: Rule,
  reply: ActionResult | null,
  ctx: Ctx,
) {
  const db = getDb();
  const ruleName = rule.name.trim() || `Pravidlo #${rule.id}`;
  const [claim] = await db
    .insert(eventsLog)
    .values({
      accountId: account.id,
      ruleId: rule.id,
      direction: "out",
      kind: "rule_notify",
      status: "pending",
      igObjectId: mid,
      contactIgId: contact.igScopedId,
      text: ruleName,
    })
    .returning({ id: eventsLog.id });

  const [recent] = await db
    .select({ n: count() })
    .from(eventsLog)
    .where(
      and(
        eq(eventsLog.accountId, account.id),
        eq(eventsLog.contactIgId, contact.igScopedId),
        eq(eventsLog.ruleId, rule.id),
        eq(eventsLog.kind, "rule_notify"),
        inArray(eventsLog.status, ["pending", "sent"]),
        lt(eventsLog.id, claim.id),
        gt(eventsLog.createdAt, new Date(ctx.now.getTime() - RULE_NOTIFY_WINDOW_MS)),
      ),
    );
  const finish = (status: "sent" | "failed" | "skipped", detail: string) =>
    db.update(eventsLog).set({ status, detail }).where(eq(eventsLog.id, claim.id));
  if (recent.n > 0) {
    await finish("skipped", `Upozornění na toto pravidlo a kontakt už odešlo v posledních ${RULE_NOTIFY_WINDOW_MS / 3600_000} h`);
    return;
  }

  const history = await loadConversation(account.id, contact.igScopedId, ctx);
  const res = await sendEmail(
    buildRuleEmail({
      to,
      accountUsername: account.username,
      contact: contactDisplay(contact.username, contact.igScopedId),
      ruleName,
      message: text,
      botReply: reply?.status === "sent" ? reply.text : null,
      botReplyNote: reply ? reply.detail : "pravidlo nemá text DM",
      history,
      at,
    }),
  );
  await finish(res.ok ? "sent" : res.skipped ? "skipped" : "failed", `→ ${to} · ${res.ok ? `Resend id=${res.id}` : res.error}`);
}

/** Posledních N zpráv konverzace s kontaktem (příchozí DM + úspěšně odeslané odpovědi bota i člověka), od nejstarší. */
async function loadConversation(accountId: number, contactIgId: string, ctx: Ctx): Promise<(ChatTurn & { at: Date })[]> {
  const rows = await getDb()
    .select({ direction: eventsLog.direction, text: eventsLog.text, at: eventsLog.createdAt })
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
            inArray(eventsLog.kind, ["dm", "private_reply", "ai_reply", "human_reply"]),
            eq(eventsLog.status, "sent"),
          ),
        ),
      ),
    )
    .orderBy(desc(eventsLog.createdAt), desc(eventsLog.id))
    .limit(AI_HISTORY_LIMIT);
  return rows.reverse().map((r) => ({ role: r.direction === "in" ? "user" : "model", text: r.text ?? "", at: r.at }));
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
  watchToken(account, res, ctx);
  const status = res.ok ? "sent" : "failed";
  const detail = res.ok ? `${res.mock ? "MOCK " : ""}id=${res.id}` : res.error;
  await db
    .update(eventsLog)
    .set({ status, detail, payload: res.request, igMessageId: sentMid(kind, res) })
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

/**
 * Pošle sender_action typing_on a vrátí funkci, která před odesláním textu počká do typingDelayMs (od zavolání).
 * V simulaci a MOCK režimu nic neposílá ani nečeká. Chyba typing_on odpověď nikdy neblokuje.
 */
async function startTyping(account: Account, recipientId: string, ctx: Ctx): Promise<(text: string) => Promise<void>> {
  if (ctx.simulated || env.instagramMock) return async () => {};
  const started = Date.now();
  const res = await ig.sendSenderAction(account.igUserId, recipientId, "typing_on", { accessToken: tokenFor(account, ctx) });
  if (!res.ok) console.warn(`[engine] typing_on selhal (@${account.username}): ${res.error}`);
  return async (text) => {
    const wait = typingDelayMs(text) - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  };
}

/**
 * Chyba tokenu (OAuthException 190) při odesílání → e-mail na notify_email (max. 1× za 6 h na účet).
 * Jde do odložených úloh, aby nezdržel další odpovědi ze stejného webhooku.
 */
function watchToken(account: Account, res: ig.GraphResult, ctx: Ctx) {
  if (!res.tokenError || ctx.simulated) return;
  console.error(`[engine] @${account.username}: Instagram odmítl access token – ${res.error}`);
  ctx.deferred.push(() => sendTokenAlert(account, "api_error", account.tokenExpiresAt, res.error ?? null, ctx.now));
}

/** Mid odeslané DM (Send API vrací message_id) – podle něj se pozná echo vlastní zprávy. */
function sentMid(kind: ActionResult["kind"], res: ig.GraphResult) {
  return kind !== "public_reply" && res.ok && res.id ? res.id : null;
}

function tokenFor(account: Account, ctx: Ctx) {
  if (ctx.simulated || env.instagramMock || !account.accessToken) return null;
  return decrypt(account.accessToken);
}


function formatPragueTime(d: Date) {
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Prague" }).format(d);
}

/** Meta posílá čas v sekundách i v milisekundách podle typu události. */
function toDate(t: number | undefined, fallback: Date) {
  if (!t) return fallback;
  return new Date(t < 1e12 ? t * 1000 : t);
}
