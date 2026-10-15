import { test } from "node:test";
import assert from "node:assert/strict";
import type { TokenAlertReason } from "@/lib/notify/email";
import {
  alertInterval,
  API_ERROR_ALERT_INTERVAL_MS,
  checkAccountToken,
  daysLeft,
  needsRefresh,
  shouldWarn,
  tokenState,
  type CheckDeps,
  type TokenAccount,
} from "./refresh";

const now = new Date("2026-10-15T06:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

test("needsRefresh: do 15 dní a neznámá platnost ano, déle ne", () => {
  assert.equal(needsRefresh(inDays(30), now), false);
  assert.equal(needsRefresh(inDays(15.01), now), false);
  assert.equal(needsRefresh(inDays(15), now), true);
  assert.equal(needsRefresh(inDays(3), now), true);
  assert.equal(needsRefresh(inDays(-1), now), true);
  assert.equal(needsRefresh(null, now), true);
});

test("shouldWarn: do 7 dní (i po vypršení), neznámá platnost ne", () => {
  assert.equal(shouldWarn(inDays(8), now), false);
  assert.equal(shouldWarn(inDays(7), now), true);
  assert.equal(shouldWarn(inDays(-2), now), true);
  assert.equal(shouldWarn(null, now), false);
});

test("tokenState a daysLeft pro admin", () => {
  assert.equal(tokenState(false, inDays(30), now), "missing");
  assert.equal(tokenState(true, null, now), "unknown");
  assert.equal(tokenState(true, inDays(-0.1), now), "expired");
  assert.equal(tokenState(true, inDays(5), now), "warn");
  assert.equal(tokenState(true, inDays(12), now), "refresh");
  assert.equal(tokenState(true, inDays(40), now), "ok");
  assert.equal(daysLeft(inDays(12.5), now), 12);
  assert.equal(daysLeft(null, now), null);
});

test("chyba tokenu z API: e-mail max 1× za 6 h", () => {
  assert.equal(alertInterval("api_error"), API_ERROR_ALERT_INTERVAL_MS);
  assert.equal(API_ERROR_ALERT_INTERVAL_MS, 6 * 3600_000);
});

function fakeDeps(refresh: CheckDeps["refresh"]) {
  const saved: { token: string; expiresAt: Date }[] = [];
  const alerts: { reason: TokenAlertReason; expiresAt: Date | null; error: string | null }[] = [];
  const deps: CheckDeps = {
    refresh,
    save: async (_a, token, expiresAt) => void saved.push({ token, expiresAt }),
    alert: async (_a, reason, expiresAt, error) => void alerts.push({ reason, expiresAt, error }),
  };
  return { deps, saved, alerts };
}

const acc = (expiresAt: Date | null, accessToken: string | null = "enc"): TokenAccount => ({
  id: 1,
  username: "firma",
  accessToken,
  tokenExpiresAt: expiresAt,
});

test("checkAccountToken: token s dlouhou platností se neobnovuje ani nehlásí", async () => {
  let called = false;
  const { deps, saved, alerts } = fakeDeps(async () => ((called = true), { ok: false, error: "x" }));
  const r = await checkAccountToken(acc(inDays(40)), now, deps);
  assert.equal(r.action, "skipped");
  assert.deepEqual([called, saved.length, alerts.length], [false, 0, 0]);
});

test("checkAccountToken: účet bez tokenu se přeskočí", async () => {
  const { deps, alerts } = fakeDeps(async () => ({ ok: false, error: "x" }));
  const r = await checkAccountToken(acc(inDays(2), null), now, deps);
  assert.deepEqual([r.action, alerts.length], ["skipped", 0]);
});

test("checkAccountToken: úspěšná obnova uloží token, bez e-mailu", async () => {
  const { deps, saved, alerts } = fakeDeps(async () => ({ ok: true, accessToken: "NEW", expiresAt: inDays(60) }));
  const r = await checkAccountToken(acc(inDays(10)), now, deps);
  assert.equal(r.action, "refreshed");
  assert.deepEqual(saved, [{ token: "NEW", expiresAt: inDays(60) }]);
  assert.equal(alerts.length, 0);
});

test("checkAccountToken: obnova selže → e-mail refresh_failed s chybou (i když zbývá 14 dní)", async () => {
  const { deps, saved, alerts } = fakeDeps(async () => ({ ok: false, error: "Error validating access token", tokenError: true }));
  const r = await checkAccountToken(acc(inDays(14)), now, deps);
  assert.equal(r.action, "failed");
  assert.equal(saved.length, 0);
  assert.deepEqual(alerts, [{ reason: "refresh_failed", expiresAt: inDays(14), error: "Error validating access token" }]);
});

test("checkAccountToken: výjimka z refresh se bere jako selhání", async () => {
  const { deps, alerts } = fakeDeps(async () => {
    throw new Error("network down");
  });
  const r = await checkAccountToken(acc(inDays(3)), now, deps);
  assert.equal(r.action, "failed");
  assert.equal(alerts[0].error, "network down");
});

test("checkAccountToken: obnova vrátí krátkou platnost → e-mail expiring", async () => {
  const { deps, alerts } = fakeDeps(async () => ({ ok: true, accessToken: "NEW", expiresAt: inDays(5) }));
  const r = await checkAccountToken(acc(inDays(5)), now, deps);
  assert.deepEqual([r.action, r.alert], ["refreshed", "expiring"]);
  assert.equal(alerts.length, 1);
});

test("checkAccountToken: neznámá platnost → pokus o obnovu", async () => {
  const { deps, saved } = fakeDeps(async () => ({ ok: true, accessToken: "NEW", expiresAt: inDays(60) }));
  const r = await checkAccountToken(acc(null), now, deps);
  assert.equal(r.action, "refreshed");
  assert.equal(saved.length, 1);
});
