/**
 * Doplní proměnné typu {username}. Neznámé proměnné nechá být.
 * Když je některá hodnota prázdná, uklidí po ní mezery ("Ahoj {username}! 👋" → "Ahoj! 👋").
 */
export function fillTemplate(template: string, vars: Record<string, string>) {
  let hadEmpty = false;
  const out = template.replace(/(@?)\{(\w+)\}/g, (m, at: string, k: string) => {
    if (!(k in vars)) return m;
    const value = vars[k].trim();
    if (!value) {
      hadEmpty = true;
      return ""; // i s případným "@" před proměnnou
    }
    return at + value;
  });
  return hadEmpty ? tidy(out) : out;
}

function tidy(s: string) {
  return s
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+([,.!?;:…)])/g, "$1") // mezera před interpunkcí
        .replace(/\([ \t]+/g, "(")
        .replace(/^([ \t]*)[,;:][ \t]*/, "$1") // čárka na začátku řádku po prázdné proměnné
        .replace(/[ \t]{2,}/g, " ")
        .trimEnd(),
    )
    .join("\n")
    .trim();
}
