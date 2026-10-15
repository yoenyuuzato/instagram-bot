/** Jak dlouho "psát" před odesláním odpovědi: ~1–2 s podle délky textu, max. 2,5 s. */
export const TYPING_MIN_MS = 1_000;
export const TYPING_MAX_MS = 2_500;

export function typingDelayMs(text: string) {
  return Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, 800 + [...text].length * 8));
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
