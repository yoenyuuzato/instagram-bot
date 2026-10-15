/**
 * Obnova tokenů a upozornění nad databází: denní cron (/api/cron/refresh-tokens), tlačítko „Obnovit teď“
 * a e-mail při chybě tokenu z Instagram API (lib/engine/process.ts).
 */
import { and, count, eq, gt, inArray, isNotNull, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, eventsLog } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshAccessToken, type RefreshResult } from "@/lib/instagram";
import { buildTokenEmail, sendEmail, type TokenAlertReason } from "@/lib/notify/email";
import { alertInterval, checkAccountToken, type CheckDeps, type CheckOutcome, type TokenAccount } from "./refresh";

/** Odkaz do adminu do e-mailu – na Vercelu z produkční domény projektu. */
function adminUrl() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}/admin/accounts` : null;
}

async function refreshAccount(account: TokenAccount, now: Date): Promise<RefreshResult> {
  if (!account.accessToken) return { ok: false, error: "Účet nemá access token" };
  let token: string;
  try {
    token = decrypt(account.accessToken);
  } catch {
    return { ok: false, error: "Access token nejde dešifrovat (TOKEN_ENCRYPTION_KEY)" };
  }
  return refreshAccessToken(token, now);
}

async function saveToken(account: TokenAccount, accessToken: string, expiresAt: Date, now: Date) {
  const db = getDb();
  await db
    .update(accounts)
    .set({ accessToken: encrypt(accessToken), tokenExpiresAt: expiresAt, updatedAt: now })
    .where(eq(accounts.id, account.id));
  await db.insert(eventsLog).values({
    accountId: account.id,
    direction: "out",
    kind: "token_refresh",
    status: "sent",
    detail: `Token obnoven, platí do ${expiresAt.toISOString()}`,
  });
}

async function logRefreshFailure(account: TokenAccount, error: string) {
  await getDb().insert(eventsLog).values({
    accountId: account.id,
    direction: "out",
    kind: "token_refresh",
    status: "failed",
    detail: error,
  });
}

/**
 * E-mail o problému s tokenem na notify_email účtu. Max. 1× za alertInterval(reason) na účet + důvod:
 * řádek `token_alert` se založí hned, při souběhu vyhraje dřívější (stejně jako upozornění na pravidlo).
 */
export async function sendTokenAlert(
  account: Pick<TokenAccount, "id" | "username"> & { notifyEmail: string | null },
  reason: TokenAlertReason,
  expiresAt: Date | null,
  error: string | null,
  now = new Date(),
) {
  const to = account.notifyEmail?.trim();
  const db = getDb();
  const [claim] = await db
    .insert(eventsLog)
    .values({ accountId: account.id, direction: "out", kind: "token_alert", status: "pending", text: reason, detail: error })
    .returning({ id: eventsLog.id });
  const finish = (status: "sent" | "failed" | "skipped", detail: string) =>
    db.update(eventsLog).set({ status, detail }).where(eq(eventsLog.id, claim.id));

  if (!to) {
    console.warn(`[tokens] @${account.username}: ${reason}${error ? ` (${error})` : ""} – účet nemá e-mail pro upozornění`);
    await finish("skipped", `Účet nemá e-mail pro upozornění${error ? ` · ${error}` : ""}`);
    return;
  }

  const interval = alertInterval(reason);
  const [recent] = await db
    .select({ n: count() })
    .from(eventsLog)
    .where(
      and(
        eq(eventsLog.accountId, account.id),
        eq(eventsLog.kind, "token_alert"),
        eq(eventsLog.text, reason),
        inArray(eventsLog.status, ["pending", "sent"]),
        lt(eventsLog.id, claim.id),
        gt(eventsLog.createdAt, new Date(now.getTime() - interval)),
      ),
    );
  if (recent.n > 0) {
    await finish("skipped", `Upozornění už odešlo v posledních ${interval / 3600_000} h${error ? ` · ${error}` : ""}`);
    return;
  }

  const res = await sendEmail(
    buildTokenEmail({ to, accountUsername: account.username, reason, expiresAt, error, at: now, adminUrl: adminUrl() }),
  );
  await finish(res.ok ? "sent" : res.skipped ? "skipped" : "failed", `→ ${to} · ${res.ok ? `Resend id=${res.id}` : res.error}${error ? ` · ${error}` : ""}`);
}

/** Denní cron: všechny aktivní účty s tokenem. */
export async function refreshExpiringTokens(now = new Date()): Promise<CheckOutcome[]> {
  const rows = await getDb()
    .select()
    .from(accounts)
    .where(and(eq(accounts.active, true), isNotNull(accounts.accessToken)));

  const outcomes: CheckOutcome[] = [];
  for (const account of rows) {
    const deps: CheckDeps = {
      refresh: (a) => refreshAccount(a, now),
      save: (a, token, expiresAt) => saveToken(a, token, expiresAt, now),
      alert: async (a, reason, expiresAt, error) => {
        if (reason === "refresh_failed" && error) await logRefreshFailure(a, error);
        await sendTokenAlert(account, reason, expiresAt, error, now);
      },
    };
    try {
      outcomes.push(await checkAccountToken(account, now, deps));
    } catch (e) {
      console.error(`[tokens] @${account.username}: kontrola tokenu selhala`, e);
      outcomes.push({
        accountId: account.id,
        username: account.username,
        action: "failed",
        expiresAt: account.tokenExpiresAt,
        alert: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return outcomes;
}

/** Ruční obnova z adminu – bez ohledu na zbývající platnost, bez e-mailu. */
export async function refreshTokenNow(accountId: number, now = new Date()) {
  const [account] = await getDb().select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) return { ok: false as const, error: "Účet nenalezen." };
  const res = await refreshAccount(account, now);
  if (!res.ok) {
    await logRefreshFailure(account, res.error);
    return res;
  }
  await saveToken(account, res.accessToken, res.expiresAt, now);
  return res;
}
