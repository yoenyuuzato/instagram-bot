import type { Rule } from "@/lib/db/schema";
import { countWords, normalizeForExact, normalizeText } from "./normalize";

export type IncomingEvent =
  | { type: "comment"; text: string; postId?: string | null }
  | { type: "dm"; text: string };

/** "precise" = přesná shoda (exact / contains), "fuzzy" = shoda s tolerancí překlepů (jen contains). */
export type MatchQuality = "precise" | "fuzzy";

export function matchQuality(rule: Rule, event: IncomingEvent): MatchQuality | null {
  if (!rule.active || rule.triggerType !== event.type) return null;
  if (event.type === "comment" && rule.postId && rule.postId !== event.postId) return null;
  // "Jen krátká zpráva" – delší text pravidlo přeskočí (u DM pak může odpovědět AI).
  if (rule.maxWords && countWords(event.text) > rule.maxWords) return null;

  const keywords = rule.keywords.map((k) => k.trim()).filter(Boolean);
  // Pravidlo bez klíčových slov = reaguje na cokoliv.
  if (keywords.length === 0) return "precise";

  if (rule.matchMode === "exact") {
    const text = normalizeForExact(event.text);
    return keywords.some((k) => normalizeForExact(k) === text) ? "precise" : null;
  }
  const text = normalizeText(event.text);
  if (keywords.some((k) => text.includes(normalizeText(k)))) return "precise";
  return keywords.some((k) => fuzzyContains(text, normalizeText(k))) ? "fuzzy" : null;
}

export function ruleMatches(rule: Rule, event: IncomingEvent): boolean {
  return matchQuality(rule, event) !== null;
}

// --- Tolerance překlepů -------------------------------------------------------------

/** Povolený počet překlepů podle délky slova: do 3 znaků přesně, 4–6 znaků ≤1, delší ≤2. */
export function typoTolerance(word: string) {
  const len = [...word].length;
  return len >= 7 ? 2 : len >= 4 ? 1 : 0;
}

/** Levenshteinova vzdálenost; nad `max` vrací max + 1 (předčasné ukončení). */
export function levenshtein(a: string, b: string, max = Infinity): number {
  const s = [...a];
  const t = [...b];
  if (Math.abs(s.length - t.length) > max) return max + 1;
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[t.length];
}

const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Fuzzy "obsahuje": slova klíčového slova musí v textu jít po sobě a každé se smí lišit nejvýš o typoTolerance.
 * Vstupy už normalizované (normalizeText).
 */
export function fuzzyContains(text: string, keyword: string): boolean {
  const kw = words(keyword);
  const tw = words(text);
  if (!kw.length || kw.length > tw.length) return false;
  for (let start = 0; start + kw.length <= tw.length; start++) {
    if (kw.every((k, i) => levenshtein(k, tw[start + i], typoTolerance(k)) <= typoTolerance(k))) return true;
  }
  return false;
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
  const precise = keywords.map(normalizeText).filter((k) => text.includes(k));
  const matched = precise.length ? precise : keywords.map(normalizeText).filter((k) => fuzzyContains(text, k));
  return Math.max(0, ...matched.map((k) => k.length));
}

/** Přesná shoda > shoda s překlepem; pak specifičtější pravidla: konkrétní post > exact > contains > delší shoda > starší. */
function specificity(rule: Rule) {
  return (rule.postId ? 4 : 0) + (rule.matchMode === "exact" ? 2 : 0) + (rule.keywords.length > 0 ? 1 : 0);
}

export function findMatchingRule(rules: Rule[], event: IncomingEvent): Rule | null {
  const fuzzy = new Map<number, number>();
  const candidates = rules.filter((r) => {
    const q = matchQuality(r, event);
    if (q) fuzzy.set(r.id, q === "fuzzy" ? 1 : 0);
    return q !== null;
  });
  const len = new Map(candidates.map((r) => [r.id, matchLength(r, event)]));
  candidates.sort(
    (a, b) =>
      fuzzy.get(a.id)! - fuzzy.get(b.id)! ||
      specificity(b) - specificity(a) ||
      len.get(b.id)! - len.get(a.id)! ||
      a.id - b.id,
  );
  return candidates[0] ?? null;
}
