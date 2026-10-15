/** Detekce kontaktních údajů v textu DM – e-mail a telefonní čísla CZ/SK. */

export type ContactHit = { type: "email" | "phone"; /** normalizovaná hodnota (dedup) */ value: string; /** jak to napsal uživatel */ raw: string };

const EMAIL_RE = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?![\p{L}\p{N}-])/giu;

/**
 * CZ/SK čísla: volitelná předvolba +420/+421 nebo 00420/00421, pak 9 číslic; bez předvolby 9 číslic
 * (CZ, nezačíná 0) nebo 10 číslic začínajících 0 (SK národní formát, např. 0905 123 456).
 * Mezi číslicemi mohou být mezery, pomlčky, tečky nebo lomítko.
 */
const PHONE_RE = /(?<![\d+])(?:(?:\+|00)\s?(42[01])[\s./-]?)?(\(?\d(?:[\s./-]?\)?\d){8,9})(?![\d])/g;

export function detectContacts(text: string): ContactHit[] {
  const hits: ContactHit[] = [];
  const seen = new Set<string>();
  const add = (hit: ContactHit) => {
    const key = `${hit.type}:${hit.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      hits.push(hit);
    }
  };

  for (const m of text.matchAll(EMAIL_RE)) {
    const raw = m[0].replace(/\.+$/, "");
    add({ type: "email", value: raw.toLowerCase(), raw });
  }

  // E-maily vymažeme, ať se číslice z adres nechytí jako telefon.
  const rest = text.replace(EMAIL_RE, " ");
  for (const m of rest.matchAll(PHONE_RE)) {
    const value = normalizePhone(m[1] ?? null, m[2].replace(/\D/g, ""));
    if (value) add({ type: "phone", value, raw: m[0].trim() });
  }
  return hits;
}

function normalizePhone(prefix: string | null, digits: string): string | null {
  if (prefix) return digits.length === 9 && digits[0] !== "0" ? `+${prefix}${digits}` : null;
  if (digits.length === 9 && digits[0] !== "0") return `+420${digits}`;
  if (digits.length === 10 && digits[0] === "0" && digits[1] !== "0") return `+421${digits.slice(1)}`;
  return null;
}

/** +420777123456 → +420 777 123 456 */
export function formatPhone(value: string) {
  const m = value.match(/^\+(\d{3})(\d{3})(\d{3})(\d{3})$/);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : value;
}
