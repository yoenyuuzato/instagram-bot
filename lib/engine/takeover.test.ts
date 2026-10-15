import { test } from "node:test";
import assert from "node:assert/strict";
import { isBotEcho, isBotPaused, nextPauseState, parseHumanCommand, type EchoLookup, type PauseState } from "./takeover";

const NOW = new Date("2026-10-15T12:00:00Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
const none: PauseState = { botPausedUntil: null, botPausedPermanent: false };

test("parseHumanCommand: #bot / #stop jako samostatné slovo, bez ohledu na velikost", () => {
  assert.equal(parseHumanCommand("#bot"), "resume");
  assert.equal(parseHumanCommand("  #BOT "), "resume");
  assert.equal(parseHumanCommand("Díky, předávám zpět #bot"), "resume");
  assert.equal(parseHumanCommand("#stop"), "stop");
  assert.equal(parseHumanCommand("#Stop, tohle řeším já."), "stop");
  assert.equal(parseHumanCommand("#stop a pak #bot"), "resume");
  assert.equal(parseHumanCommand("#bot a pak #stop"), "stop");
});

test("parseHumanCommand: ostatní texty nejsou příkaz", () => {
  assert.equal(parseHumanCommand("Dobrý den, jak vám mohu pomoci?"), null);
  assert.equal(parseHumanCommand("#botik"), null);
  assert.equal(parseHumanCommand("#stopka"), null);
  assert.equal(parseHumanCommand("##bot"), null);
  assert.equal(parseHumanCommand("robot"), null);
  assert.equal(parseHumanCommand("bot"), null);
  assert.equal(parseHumanCommand("a#bot"), null);
  assert.equal(parseHumanCommand(""), null);
  assert.equal(parseHumanCommand(undefined), null);
});

test("isBotPaused: do kdy / natrvalo", () => {
  assert.equal(isBotPaused(none, NOW), false);
  assert.equal(isBotPaused({ botPausedUntil: min(1), botPausedPermanent: false }, NOW), true);
  assert.equal(isBotPaused({ botPausedUntil: NOW, botPausedPermanent: false }, NOW), false);
  assert.equal(isBotPaused({ botPausedUntil: min(-5), botPausedPermanent: false }, NOW), false);
  assert.equal(isBotPaused({ botPausedUntil: null, botPausedPermanent: true }, NOW), true);
  assert.equal(isBotPaused({ botPausedUntil: min(-5), botPausedPermanent: true }, NOW), true);
});

test("nextPauseState: ruční odpověď nastaví pauzu na N minut", () => {
  assert.deepEqual(nextPauseState(none, null, 30, NOW), { botPausedUntil: min(30), botPausedPermanent: false });
  // prošlá pauza se obnoví
  assert.deepEqual(nextPauseState({ botPausedUntil: min(-10), botPausedPermanent: false }, null, 30, NOW), {
    botPausedUntil: min(30),
    botPausedPermanent: false,
  });
  // běžící pauza se prodlouží
  assert.deepEqual(nextPauseState({ botPausedUntil: min(5), botPausedPermanent: false }, null, 30, NOW), {
    botPausedUntil: min(30),
    botPausedPermanent: false,
  });
});

test("nextPauseState: nezkracuje delší pauzu, nemění trvalou, 0 minut = bez automatické pauzy", () => {
  assert.equal(nextPauseState({ botPausedUntil: min(120), botPausedPermanent: false }, null, 30, NOW), null);
  assert.equal(nextPauseState({ botPausedUntil: null, botPausedPermanent: true }, null, 30, NOW), null);
  assert.equal(nextPauseState(none, null, 0, NOW), null);
});

test("nextPauseState: #bot zruší pauzu, #stop nastaví natrvalo", () => {
  const permanent = { botPausedUntil: null, botPausedPermanent: true };
  const cleared = { botPausedUntil: null, botPausedPermanent: false };
  assert.deepEqual(nextPauseState(permanent, "resume", 30, NOW), cleared);
  assert.deepEqual(nextPauseState({ botPausedUntil: min(20), botPausedPermanent: false }, "resume", 30, NOW), cleared);
  assert.deepEqual(nextPauseState(none, "stop", 30, NOW), permanent);
  assert.deepEqual(nextPauseState(none, "stop", 0, NOW), permanent);
  assert.deepEqual(nextPauseState({ botPausedUntil: min(20), botPausedPermanent: false }, "stop", 30, NOW), permanent);
});

/** Lookup se scénářem: `sent[i]` = je mid uložený při i-tém dotazu, `pending[i]` = běží odesílání při i-tém dotazu. */
function lookup(sent: boolean[], pending: boolean[]) {
  let s = 0;
  let p = 0;
  const sleeps: number[] = [];
  const l: EchoLookup = {
    isSentByBot: async () => sent[Math.min(s++, sent.length - 1)],
    hasPendingSend: async () => pending[Math.min(p++, pending.length - 1)],
    sleep: async (ms) => void sleeps.push(ms),
  };
  return { l, sleeps };
}

test("isBotEcho: mid uložený botem = echo bota, bez čekání", async () => {
  const { l, sleeps } = lookup([true], [false]);
  assert.equal(await isBotEcho(l), true);
  assert.equal(sleeps.length, 0);
});

test("isBotEcho: neznámý mid a bot nic neodesílá = ruční zpráva", async () => {
  const { l, sleeps } = lookup([false], [false]);
  assert.equal(await isBotEcho(l), false);
  assert.equal(sleeps.length, 0);
});

test("isBotEcho: echo předběhlo uložení mid – počká, až se mid objeví", async () => {
  const { l, sleeps } = lookup([false, false, true], [true]);
  assert.equal(await isBotEcho(l, { attempts: 5, intervalMs: 10 }), true);
  assert.deepEqual(sleeps, [10, 10]);
});

test("isBotEcho: odesílání skončilo a mid se neobjevil = ruční zpráva", async () => {
  const { l } = lookup([false], [true, false]);
  assert.equal(await isBotEcho(l, { attempts: 5, intervalMs: 10 }), false);
});

test("isBotEcho: odesílání pořád běží – v pochybnostech echo bota (nepozastavit omylem)", async () => {
  const { l, sleeps } = lookup([false], [true]);
  assert.equal(await isBotEcho(l, { attempts: 3, intervalMs: 10 }), true);
  assert.equal(sleeps.length, 3);
});
