/** lowercase, bez diakritiky, sjednocené mezery. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Pro exact match ignorujeme i interpunkci a emoji na okrajích ("Chci!" == "chci"). */
export function normalizeForExact(input: string): string {
  return normalizeText(input).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
