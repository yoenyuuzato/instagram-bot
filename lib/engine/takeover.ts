/**
 * Ruční převzetí konverzace (human takeover) v DM.
 *
 * Instagram API with Instagram Login posílá echo každé zprávy odeslané z našeho účtu (botem i člověkem
 * v aplikaci / Meta Business Suite) jako `messages` webhook s `message.is_echo: true`. Echo obsahuje jen
 * `mid`, `text` a `is_echo` – na rozdíl od Messengeru v něm není `app_id`, takže botovu zprávu poznáme
 * jen podle `mid` uloženého z odpovědi Send API (`{ recipient_id, message_id }`).
 */

export type HumanCommand = "resume" | "stop";

export type PauseState = { botPausedUntil: Date | null; botPausedPermanent: boolean };

export const PAUSE_LOG_DETAIL = "Pauza – odpovídá člověk";

/**
 * Příkaz v ruční zprávě: `#bot` = zrušit pauzu, `#stop` = pauza natrvalo.
 * Hledá se samostatné slovo (ne `#botik`), na velikosti nezáleží; při obou platí poslední.
 */
export function parseHumanCommand(text: string | null | undefined): HumanCommand | null {
  let last: HumanCommand | null = null;
  for (const m of (text ?? "").matchAll(/(?<![\p{L}\p{N}_#])#(bot|stop)(?![\p{L}\p{N}_])/giu)) {
    last = m[1].toLowerCase() === "bot" ? "resume" : "stop";
  }
  return last;
}

export function isBotPaused(c: PauseState, now: Date) {
  return c.botPausedPermanent || (!!c.botPausedUntil && c.botPausedUntil.getTime() > now.getTime());
}

/**
 * Nový stav pauzy po ruční zprávě. Běžná ruční odpověď pauzu nastaví/prodlouží na `minutes` od teď
 * (nikdy ji nezkrátí a trvalou pauzu nemění); `minutes <= 0` = automatická pauza vypnutá.
 * Vrací null, když se nic nemění.
 */
export function nextPauseState(current: PauseState, command: HumanCommand | null, minutes: number, now: Date): PauseState | null {
  if (command === "resume") return { botPausedUntil: null, botPausedPermanent: false };
  if (command === "stop") return { botPausedUntil: null, botPausedPermanent: true };
  if (current.botPausedPermanent || !(minutes > 0)) return null;
  const until = new Date(now.getTime() + minutes * 60_000);
  if (current.botPausedUntil && current.botPausedUntil.getTime() >= until.getTime()) return null;
  return { botPausedUntil: until, botPausedPermanent: false };
}

export type EchoLookup = {
  /** Je mid mezi zprávami, které odeslal bot? */
  isSentByBot: () => Promise<boolean>;
  /** Odesílá bot tomuto kontaktu právě teď (claim řádek ve stavu pending, mid ještě není uložený)? */
  hasPendingSend: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Pochází echo od bota? Echo může dorazit dřív, než bot uloží mid z odpovědi Send API – když bot kontaktu
 * zrovna odesílá, chvíli počkáme. Pokud se mid neobjeví a odesílání pořád běží, bereme echo jako botovo
 * (raději nepozastavit, než pozastavit omylem).
 */
export async function isBotEcho(lookup: EchoLookup, { attempts = 8, intervalMs = 1000 } = {}) {
  if (await lookup.isSentByBot()) return true;
  for (let i = 0; i < attempts; i++) {
    if (!(await lookup.hasPendingSend())) return false;
    await lookup.sleep(intervalMs);
    if (await lookup.isSentByBot()) return true;
  }
  return true;
}
