/**
 * Pravidla automatické obnovy Instagram access tokenů (bez DB – volá ji lib/tokens/service.ts).
 * Long-lived token platí 60 dní; obnovit jde, když je starší než 24 h a ještě nevypršel.
 */
import type { RefreshResult } from "@/lib/instagram";
import type { TokenAlertReason } from "@/lib/notify/email";

const DAY_MS = 86_400_000;
/** Cron obnovuje tokeny, které vyprší do tolika dní. */
export const REFRESH_WITHIN_DAYS = 15;
/** Když token vyprší do tolika dní (a obnova nepomohla), jde e-mail. */
export const WARN_WITHIN_DAYS = 7;
/** E-mail o chybě tokenu při odesílání odpovědi max. 1× za tuto dobu na účet. */
export const API_ERROR_ALERT_INTERVAL_MS = 6 * 3600_000;
/** Upozornění z cronu (denně) – pojistka proti spamu při ručním opakovaném spuštění. */
export const CRON_ALERT_INTERVAL_MS = 20 * 3600_000;

export function alertInterval(reason: TokenAlertReason) {
  return reason === "api_error" ? API_ERROR_ALERT_INTERVAL_MS : CRON_ALERT_INTERVAL_MS;
}

/** Celé dny do vypršení (záporné = po vypršení), null = neznámá platnost. */
export function daysLeft(expiresAt: Date | null, now: Date) {
  return expiresAt ? Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS) : null;
}

/** Neznámou platnost obnovujeme taky – odpověď ji doplní. */
export function needsRefresh(expiresAt: Date | null, now: Date) {
  return !expiresAt || expiresAt.getTime() - now.getTime() <= REFRESH_WITHIN_DAYS * DAY_MS;
}

export function shouldWarn(expiresAt: Date | null, now: Date) {
  return !!expiresAt && expiresAt.getTime() - now.getTime() <= WARN_WITHIN_DAYS * DAY_MS;
}

export type TokenState = "missing" | "unknown" | "expired" | "warn" | "refresh" | "ok";

/** Stav pro zobrazení v adminu. */
export function tokenState(hasToken: boolean, expiresAt: Date | null, now: Date): TokenState {
  if (!hasToken) return "missing";
  if (!expiresAt) return "unknown";
  if (expiresAt.getTime() <= now.getTime()) return "expired";
  if (shouldWarn(expiresAt, now)) return "warn";
  if (needsRefresh(expiresAt, now)) return "refresh";
  return "ok";
}

export type TokenAccount = { id: number; username: string; accessToken: string | null; tokenExpiresAt: Date | null };

export type CheckDeps = {
  refresh: (account: TokenAccount) => Promise<RefreshResult>;
  save: (account: TokenAccount, accessToken: string, expiresAt: Date) => Promise<void>;
  alert: (account: TokenAccount, reason: TokenAlertReason, expiresAt: Date | null, error: string | null) => Promise<void>;
};

export type CheckOutcome = {
  accountId: number;
  username: string;
  action: "skipped" | "refreshed" | "failed";
  expiresAt: Date | null;
  alert: TokenAlertReason | null;
  error?: string;
};

/**
 * Jeden účet v denním cronu: obnova, když vyprší do REFRESH_WITHIN_DAYS; e-mail, když obnova selže
 * nebo token (i po pokusu) vyprší do WARN_WITHIN_DAYS. Max. jeden e-mail na účet a běh.
 */
export async function checkAccountToken(account: TokenAccount, now: Date, deps: CheckDeps): Promise<CheckOutcome> {
  const base = { accountId: account.id, username: account.username };
  if (!account.accessToken) return { ...base, action: "skipped", expiresAt: account.tokenExpiresAt, alert: null };

  if (!needsRefresh(account.tokenExpiresAt, now)) {
    return { ...base, action: "skipped", expiresAt: account.tokenExpiresAt, alert: null };
  }

  let res: RefreshResult;
  try {
    res = await deps.refresh(account);
  } catch (e) {
    res = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (res.ok) {
    await deps.save(account, res.accessToken, res.expiresAt);
    // Instagram by měl vrátit 60 dní; kdyby vrátil kratší platnost, pořád upozornit.
    const alert = shouldWarn(res.expiresAt, now) ? ("expiring" as const) : null;
    if (alert) await deps.alert(account, alert, res.expiresAt, null);
    return { ...base, action: "refreshed", expiresAt: res.expiresAt, alert };
  }

  await deps.alert(account, "refresh_failed", account.tokenExpiresAt, res.error);
  return { ...base, action: "failed", expiresAt: account.tokenExpiresAt, alert: "refresh_failed", error: res.error };
}
