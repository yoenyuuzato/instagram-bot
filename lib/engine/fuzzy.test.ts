import { test } from "node:test";
import assert from "node:assert/strict";
import type { Rule } from "@/lib/db/schema";
import { findMatchingRule, fuzzyContains, levenshtein, matchQuality, typoTolerance } from "./match";
import { normalizeText } from "./normalize";
import { typingDelayMs, TYPING_MAX_MS, TYPING_MIN_MS } from "./typing";
import { asMessage } from "./process";

const rule = (over: Partial<Rule>): Rule => ({
  id: 1, accountId: 1, name: "", triggerType: "dm", keywords: [], matchMode: "contains", postId: null, publicReply: null,
  dmText: "dm", dmButtonUrl: null, dmButtonTitle: null, maxWords: null, notifyOnMatch: false, quickReplies: [], active: true,
  createdAt: new Date(), updatedAt: new Date(), ...over,
});
const dm = (text: string) => ({ type: "dm" as const, text });
const fz = (text: string, kw: string) => fuzzyContains(normalizeText(text), normalizeText(kw));

test("levenshtein a tolerance podle délky slova", () => {
  assert.equal(levenshtein("cenik", "cennik"), 1);
  assert.equal(levenshtein("reference", "refernce"), 1);
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("abc", "abcdef", 1), 2, "předčasné ukončení vrací max + 1");
  assert.deepEqual(["seo", "cena", "sluzby", "reference"].map(typoTolerance), [0, 1, 1, 2]);
});

test("fuzzy: překlepy v 4–6 znakových slovech ≤1, v delších ≤2, krátká slova přesně", () => {
  assert.ok(fz("Kolik je cnik?", "ceník"));
  assert.ok(fz("posli cennik", "ceník"));
  assert.ok(fz("chci vidět refferencee", "reference"));
  assert.ok(fz("chci vidět rfrence", "reference"), "2 překlepy u dlouhého slova");
  assert.ok(!fz("chci vidět rfrnce", "reference"), "3 překlepy u dlouhého slova");
  assert.ok(!fz("posli cnk", "ceník"), "2 překlepy u 5znakového slova");
  assert.ok(!fz("seoo", "seo"), "krátká slova jen přesně");
  assert.ok(fz("kolik stoji tvirba webu", "tvorba webu"), "víceslovné klíčové slovo");
  // Čistý Levenshtein: přehozená písmena = 2 změny → u 4–6 znakového slova neprojde.
  assert.ok(!fz("kolik stoji tvroba webu", "tvorba webu"), "přehozená písmena v krátkém slově");
  assert.ok(fz("chci videt refrenece", "reference"), "přehozená písmena v dlouhém slově (≤2)");
  assert.ok(!fz("tvorba a webu", "tvorba webu"), "slova musí jít po sobě");
});

test("fuzzy shoda má nižší prioritu než přesná", () => {
  const cenik = rule({ id: 1, keywords: ["ceník"] });
  const cena = rule({ id: 2, keywords: ["cena"] });
  assert.equal(matchQuality(cenik, dm("pošli cenik")), "precise");
  assert.equal(matchQuality(cenik, dm("pošli cennik")), "fuzzy");
  assert.equal(matchQuality(rule({ keywords: ["ceník"], matchMode: "exact" }), dm("cennik")), null, "exact bez tolerance");
  // "ceny" je 1 překlep od "cena", od "ceník" víc → fuzzy vyhraje "cena".
  assert.equal(findMatchingRule([cenik, cena], dm("jaké máte ceny"))?.id, 2);
  // Přesná shoda vyhraje i nad specifičtějším fuzzy pravidlem (konkrétní post).
  const post = rule({ id: 3, triggerType: "comment", keywords: ["reference"], postId: "p1" });
  const any = rule({ id: 4, triggerType: "comment", keywords: ["refernce"] });
  assert.equal(findMatchingRule([post, any], { type: "comment", text: "refernce", postId: "p1" })?.id, 4);
  // Fuzzy pořád respektuje max_words.
  assert.equal(matchQuality(rule({ keywords: ["ceník"], maxWords: 2 }), dm("pošli prosím celý cennik")), null);
});

test("typingDelayMs: 1–2,5 s podle délky", () => {
  assert.equal(typingDelayMs("ok"), TYPING_MIN_MS);
  assert.ok(typingDelayMs("x".repeat(100)) > 1_500 && typingDelayMs("x".repeat(100)) < 2_000);
  assert.equal(typingDelayMs("x".repeat(600)), TYPING_MAX_MS);
});

test("asMessage: quick reply i ice breaker postback jako běžná zpráva", () => {
  const base = { sender: { id: "u1" }, recipient: { id: "acc" }, timestamp: 1_700_000_000_000 };
  const qr = { ...base, message: { mid: "m1", text: "💰 Ceník", quick_reply: { payload: "💰 Ceník" } } };
  assert.equal(asMessage(qr), qr);
  const pb = asMessage({ ...base, postback: { mid: "pb1", title: "Kolik stojí web?", payload: "Kolik stojí web?" } });
  assert.deepEqual(pb?.message, { mid: "pb1", text: "Kolik stojí web?" });
  const noMid = asMessage({ ...base, postback: { title: "Reference" } });
  assert.deepEqual(noMid?.message, { mid: "postback_u1_1700000000000", text: "Reference" });
  assert.equal(asMessage({ ...base }), null);
});
