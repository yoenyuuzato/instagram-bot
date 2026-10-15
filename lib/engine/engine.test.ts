import { test } from "node:test";
import assert from "node:assert/strict";
import type { Rule } from "@/lib/db/schema";
import { countWords, normalizeForExact, normalizeText } from "./normalize";
import { findMatchingRule, ruleMatches } from "./match";
import { isWithinDmWindow, isWithinPrivateReplyWindow } from "./window";
import { signPayload, verifySignature } from "@/lib/webhook-signature";

const rule = (over: Partial<Rule>): Rule => ({
  id: 1,
  accountId: 1,
  name: "",
  triggerType: "comment",
  keywords: [],
  matchMode: "contains",
  postId: null,
  publicReply: "ok",
  dmText: "dm",
  dmButtonUrl: null,
  dmButtonTitle: null,
  maxWords: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

test("normalizace: lowercase, bez diakritiky, mezery", () => {
  assert.equal(normalizeText("  Chci   ŽLUŤOUČKÝ  kůň "), "chci zlutoucky kun");
  assert.equal(normalizeForExact("Chci!!! 🔥"), "chci");
});

test("contains vs exact", () => {
  const contains = rule({ keywords: ["ebook"] });
  const exact = rule({ keywords: ["chci"], matchMode: "exact" });
  assert.ok(ruleMatches(contains, { type: "comment", text: "Pošli mi EBOOK prosím" }));
  assert.ok(!ruleMatches(contains, { type: "comment", text: "nic" }));
  assert.ok(ruleMatches(exact, { type: "comment", text: "Chci!" }));
  assert.ok(!ruleMatches(exact, { type: "comment", text: "chci ebook" }));
});

test("diakritika v klíčovém slově i textu", () => {
  assert.ok(ruleMatches(rule({ keywords: ["cena"] }), { type: "comment", text: "Jaká je CENA?" }));
  assert.ok(ruleMatches(rule({ keywords: ["průvodce"] }), { type: "comment", text: "chci pruvodce" }));
});

test("trigger type, post_id, active", () => {
  assert.ok(!ruleMatches(rule({ triggerType: "dm" }), { type: "comment", text: "x" }));
  assert.ok(!ruleMatches(rule({ active: false }), { type: "comment", text: "x" }));
  const r = rule({ postId: "123" });
  assert.ok(ruleMatches(r, { type: "comment", text: "x", postId: "123" }));
  assert.ok(!ruleMatches(r, { type: "comment", text: "x", postId: "999" }));
});

test("priorita: konkrétní post > exact > contains", () => {
  const rules = [
    rule({ id: 1, keywords: ["chci"] }),
    rule({ id: 2, keywords: ["chci"], matchMode: "exact" }),
    rule({ id: 3, keywords: ["chci"], postId: "p1" }),
  ];
  assert.equal(findMatchingRule(rules, { type: "comment", text: "chci", postId: "p1" })?.id, 3);
  assert.equal(findMatchingRule(rules, { type: "comment", text: "chci", postId: "p2" })?.id, 2);
  assert.equal(findMatchingRule(rules, { type: "comment", text: "chci to", postId: "p2" })?.id, 1);
});

test("24h DM okno a 7denní private reply okno", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  assert.ok(isWithinDmWindow(new Date("2026-01-10T00:00:00Z"), now));
  assert.ok(!isWithinDmWindow(new Date("2026-01-09T11:00:00Z"), now));
  assert.ok(!isWithinDmWindow(null, now));
  assert.ok(isWithinPrivateReplyWindow(new Date("2026-01-05T12:00:00Z"), now));
  assert.ok(!isWithinPrivateReplyWindow(new Date("2026-01-02T12:00:00Z"), now));
});

test("X-Hub-Signature-256", () => {
  const body = JSON.stringify({ object: "instagram", entry: [] });
  const sig = signPayload(body, "secret");
  assert.ok(verifySignature(body, sig, "secret"));
  assert.ok(!verifySignature(body, sig, "other"));
  assert.ok(!verifySignature(body + " ", sig, "secret"));
  assert.ok(!verifySignature(body, null, "secret"));
});

test("jen krátká zpráva (maxWords)", () => {
  const r = rule({ triggerType: "dm", keywords: ["cena"], maxWords: 3 });
  assert.ok(ruleMatches(r, { type: "dm", text: "Cena? 🙏" }));
  assert.ok(ruleMatches(r, { type: "dm", text: "jaká je cena" }));
  assert.ok(!ruleMatches(r, { type: "dm", text: "jaká je cena e-shopu s napojením" }));
  assert.ok(ruleMatches(rule({ triggerType: "dm", keywords: ["cena"] }), { type: "dm", text: "jaká je cena e-shopu s napojením" }));
  assert.equal(countWords("  Ahoj!!  👋 jak se máš ? "), 4);
});
