import type { Rule } from "@/lib/db/schema";
import { countWords, normalizeForExact, normalizeText } from "./normalize";

export type IncomingEvent =
  | { type: "comment"; text: string; postId?: string | null }
  | { type: "dm"; text: string };

export function ruleMatches(rule: Rule, event: IncomingEvent): boolean {
  if (!rule.active || rule.triggerType !== event.type) return false;
  if (event.type === "comment" && rule.postId && rule.postId !== event.postId) return false;
  // "Jen krátká zpráva" – delší text pravidlo přeskočí (u DM pak může odpovědět AI).
  if (rule.maxWords && countWords(event.text) > rule.maxWords) return false;

  const keywords = rule.keywords.map((k) => k.trim()).filter(Boolean);
  // Pravidlo bez klíčových slov = reaguje na cokoliv.
  if (keywords.length === 0) return true;

  if (rule.matchMode === "exact") {
    const text = normalizeForExact(event.text);
    return keywords.some((k) => normalizeForExact(k) === text);
  }
  const text = normalizeText(event.text);
  return keywords.some((k) => text.includes(normalizeText(k)));
}

/**
 * Délka shodujícího se klíčového slova (normalizovaného). U contains nejdelší klíčové slovo obsažené v textu,
 * u exact délka shodného klíčového slova. Pravidlo bez klíčových slov (nebo bez shody) = 0.
 */
export function matchLength(rule: Rule, event: IncomingEvent): number {
  const keywords = rule.keywords.map((k) => k.trim()).filter(Boolean);
  if (rule.matchMode === "exact") {
    const text = normalizeForExact(event.text);
    return keywords.map(normalizeForExact).some((k) => k === text) ? text.length : 0;
  }
  const text = normalizeText(event.text);
  return Math.max(0, ...keywords.map(normalizeText).filter((k) => text.includes(k)).map((k) => k.length));
}

/** Specifičtější pravidla mají přednost: konkrétní post > exact > contains > delší shoda > starší. */
function specificity(rule: Rule) {
  return (rule.postId ? 4 : 0) + (rule.matchMode === "exact" ? 2 : 0) + (rule.keywords.length > 0 ? 1 : 0);
}

export function findMatchingRule(rules: Rule[], event: IncomingEvent): Rule | null {
  const candidates = rules.filter((r) => ruleMatches(r, event));
  const len = new Map(candidates.map((r) => [r.id, matchLength(r, event)]));
  candidates.sort((a, b) => specificity(b) - specificity(a) || len.get(b.id)! - len.get(a.id)! || a.id - b.id);
  return candidates[0] ?? null;
}
