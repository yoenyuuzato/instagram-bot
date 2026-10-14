import type { Rule } from "@/lib/db/schema";
import { normalizeForExact, normalizeText } from "./normalize";

export type IncomingEvent =
  | { type: "comment"; text: string; postId?: string | null }
  | { type: "dm"; text: string };

export function ruleMatches(rule: Rule, event: IncomingEvent): boolean {
  if (!rule.active || rule.triggerType !== event.type) return false;
  if (event.type === "comment" && rule.postId && rule.postId !== event.postId) return false;

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

/** Specifičtější pravidla mají přednost: konkrétní post > exact > contains > starší. */
function specificity(rule: Rule) {
  return (rule.postId ? 4 : 0) + (rule.matchMode === "exact" ? 2 : 0) + (rule.keywords.length > 0 ? 1 : 0);
}

export function findMatchingRule(rules: Rule[], event: IncomingEvent): Rule | null {
  const candidates = rules.filter((r) => ruleMatches(r, event));
  candidates.sort((a, b) => specificity(b) - specificity(a) || a.id - b.id);
  return candidates[0] ?? null;
}
