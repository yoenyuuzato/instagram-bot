/**
 * Google Gemini přes REST API (bez SDK) – generateContent, free tier.
 * https://ai.google.dev/api/generate-content
 */

export const AI_TIMEOUT_MS = 8_000;
export const AI_MAX_ATTEMPTS = 2;
export const AI_MAX_CHARS = 600;

export type ChatTurn = { role: "user" | "model"; text: string };

export type AiResult = {
  ok: boolean;
  text?: string;
  model: string;
  latencyMs: number;
  attempts: number;
  error?: string;
};

/** Pravidla, která platí vždy – připojí se za system prompt účtu. */
const OUTPUT_RULES = `

Formát odpovědi:
- Piš vždy česky.
- Čistý text bez markdownu (žádné **, #, odrážky, odkazy ve tvaru [text](url)).
- Maximálně ${AI_MAX_CHARS} znaků, ideálně mnohem méně.`;

export function geminiModel() {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

/** Gemini chce střídání rolí a poslední tah od uživatele – sloučíme sousední zprávy stejné role. */
export function buildContents(history: ChatTurn[]) {
  const turns: ChatTurn[] = [];
  for (const t of history) {
    const text = t.text.trim();
    if (!text) continue;
    const last = turns.at(-1);
    if (last?.role === t.role) last.text += `\n${text}`;
    else turns.push({ role: t.role, text });
  }
  while (turns[0]?.role === "model") turns.shift();
  return turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

/** Odstraní markdown a zkrátí na AI_MAX_CHARS (nejlépe na konci věty). */
export function cleanReply(input: string, max = AI_MAX_CHARS) {
  let s = input
    .replace(/```[a-z]*\n?|```/gi, "")
    .replace(/\[([^\]]+)\]\((\S+?)\)/g, (_, label: string, url: string) => (label === url ? url : `${label} ${url}`))
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (s.length > max) {
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("\n"));
    s = end > max * 0.5 ? cut.slice(0, end + 1).trim() : `${cut.slice(0, max - 1).trimEnd()}…`;
  }
  return s;
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

class RetryableError extends Error {}

async function callOnce(model: string, apiKey: string, body: unknown): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new RetryableError(timeout ? `Timeout ${AI_TIMEOUT_MS / 1000} s` : e instanceof Error ? e.message : String(e));
  }

  const data = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    const msg = `HTTP ${res.status}: ${data.error?.message ?? res.statusText}`;
    // 429 (kvóta free tieru) a 5xx zkusíme znovu, ostatní chyby jsou trvalé.
    if (res.status === 429 || res.status >= 500) throw new RetryableError(msg);
    throw new Error(msg);
  }
  if (data.promptFeedback?.blockReason) throw new Error(`Zablokováno: ${data.promptFeedback.blockReason}`);

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts
    ?.filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new RetryableError(`Prázdná odpověď (${candidate?.finishReason ?? "bez kandidáta"})`);
  return text;
}

/** Vygeneruje odpověď na konverzaci. Nikdy nevyhazuje – chybu vrací v `error`. */
export async function generateReply(systemPrompt: string, history: ChatTurn[]): Promise<AiResult> {
  const model = geminiModel();
  const started = Date.now();
  const result = (r: Omit<AiResult, "model" | "latencyMs">): AiResult => ({ ...r, model, latencyMs: Date.now() - started });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return result({ ok: false, attempts: 0, error: "Chybí GEMINI_API_KEY" });

  const contents = buildContents(history);
  if (contents.at(-1)?.role !== "user") return result({ ok: false, attempts: 0, error: "Konverzace nekončí zprávou uživatele" });

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt.trim() + OUTPUT_RULES }] },
    contents,
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 400,
      // Flash modely 2.5 umí přemýšlení vypnout – rychlejší odpověď a tokeny nejdou na "thinking".
      ...(model.startsWith("gemini-2.5-flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  };

  let error = "";
  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS; attempt++) {
    try {
      const text = cleanReply(await callOnce(model, apiKey, body));
      if (text) return result({ ok: true, text, attempts: attempt });
      error = "Prázdná odpověď po vyčištění";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (!(e instanceof RetryableError)) return result({ ok: false, attempts: attempt, error });
    }
  }
  return result({ ok: false, attempts: AI_MAX_ATTEMPTS, error });
}
