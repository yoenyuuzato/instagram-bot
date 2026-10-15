/**
 * E-mailová upozornění přes Resend REST API (bez SDK).
 * https://resend.com/docs/api-reference/emails/send-email
 */
import { formatPhone, type ContactHit } from "./detect";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;
export const INBOX_URL = "https://www.instagram.com/direct/inbox/";

export type Email = { to: string; subject: string; text: string; html: string; replyTo?: string };
export type EmailResult = { ok: boolean; id?: string; error?: string; skipped?: boolean };

export function notifyFrom() {
  return process.env.NOTIFY_FROM || "IG Bot <onboarding@resend.dev>";
}

export function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/** Nikdy nevyhazuje. Bez RESEND_API_KEY jen zaloguje a vrátí `skipped`. */
export async function sendEmail(email: Email): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[notify] RESEND_API_KEY není nastaven – e-mail „${email.subject}“ pro ${email.to} se neposlal.`);
    return { ok: false, skipped: true, error: "Chybí RESEND_API_KEY" };
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: notifyFrom(),
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${data.message ?? data.name ?? res.statusText}` };
    return { ok: true, id: data.id };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timeout ? `Timeout ${TIMEOUT_MS / 1000} s` : e instanceof Error ? e.message : String(e) };
  }
}

// --- Šablony -------------------------------------------------------------------

const unesc = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[m]!);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }).format(d);

/** "@username", nebo – když ho neznáme (DM webhook ho neposílá) – "IG ID 1234…". */
export function contactDisplay(username: string | null | undefined, igScopedId: string) {
  return username ? `@${username}` : `IG ID ${igScopedId}`;
}

export type HistoryItem = { role: "user" | "model"; text: string; at: Date };

type Common = {
  to: string;
  accountUsername: string;
  /** Výstup contactDisplay(). */
  contact: string;
  message: string;
  history: HistoryItem[];
  at: Date;
};

const LABEL = "padding:2px 12px 2px 0;color:#666;vertical-align:top";

type Cta = { url: string; label: string };

/** Společná kostra e-mailu: hlavička s údaji, bloky obsahu, (volitelně) historie konverzace, tlačítko s odkazem. */
function render(p: {
  title: string;
  rows: [string, string][];
  textBlocks: string[];
  htmlBlocks: string[];
  history?: { items: HistoryItem[]; who: (r: HistoryItem["role"]) => string };
  cta?: Cta | null;
}) {
  const h = p.history;
  const text = [
    p.title,
    "",
    ...p.rows.map(([k, v]) => `${k}: ${unesc(v.replace(/<[^>]+>/g, ""))}`),
    "",
    ...p.textBlocks,
    ...(h ? [`Posledních ${h.items.length} zpráv konverzace:`, ...h.items.map((m) => `[${fmtTime(m.at)}] ${h.who(m.role)}: ${m.text}`), ""] : []),
    ...(p.cta ? [`${p.cta.label}: ${p.cta.url}`] : []),
  ].join("\n");

  const historyHtml = h
    ? `<p style="margin:0 0 4px;color:#666">Posledních ${h.items.length} zpráv konverzace</p>\n` +
      h.items
        .map(
          (m) =>
            `<div style="margin:6px 0;padding:8px 10px;border-radius:8px;background:${m.role === "user" ? "#f3f4f6" : "#eef2ff"}">` +
            `<div style="font-size:12px;color:#666">${esc(h.who(m.role))} · ${esc(fmtTime(m.at))}</div>` +
            `<div style="white-space:pre-wrap">${esc(m.text)}</div></div>`,
        )
        .join("")
    : "";
  const ctaHtml = p.cta
    ? `<p style="margin-top:16px"><a href="${esc(p.cta.url)}" style="display:inline-block;padding:8px 14px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${esc(p.cta.label)}</a></p>`
    : "";
  // Hodnoty v `rows` jsou už escapované HTML (kvůli odkazům mailto/tel).
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#111;max-width:600px">
<h2 style="font-size:18px;margin:0 0 12px">${esc(p.title)}</h2>
<table style="border-collapse:collapse;margin-bottom:12px">
${p.rows.map(([k, v]) => `<tr><td style="${LABEL}">${esc(k)}</td><td>${v}</td></tr>`).join("\n")}
</table>
${p.htmlBlocks.join("\n")}
${historyHtml}
${ctaHtml}
</div>`;
  return { text, html };
}

const INBOX_CTA: Cta = { url: INBOX_URL, label: "Otevřít Instagram Direct" };

function conversation(p: Common) {
  return { items: p.history, who: (r: HistoryItem["role"]) => (r === "user" ? p.contact : `@${p.accountUsername} (bot)`) };
}

const quote = (label: string, body: string) =>
  `<p style="margin:0 0 4px;color:#666">${esc(label)}</p>\n<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #111;white-space:pre-wrap">${esc(body)}</blockquote>`;

export type LeadEmailInput = Common & { hits: ContactHit[] };

export function buildLeadEmail(p: LeadEmailInput): Email {
  const rows: [string, string][] = [
    ["Účet", esc(`@${p.accountUsername}`)],
    ["Od", esc(p.contact)],
    ["Čas", esc(fmtTime(p.at))],
    ...p.hits.map((h): [string, string] => {
      const v = h.type === "email" ? h.value : formatPhone(h.value);
      const href = h.type === "email" ? `mailto:${h.value}` : `tel:${h.value}`;
      return [h.type === "email" ? "E-mail" : "Telefon", `<a href="${esc(href)}" style="font-weight:600">${esc(v)}</a>`];
    }),
  ];
  const { text, html } = render({
    history: conversation(p),
    cta: INBOX_CTA,
    title: `Nový kontakt z IG: ${p.contact}`,
    rows,
    textBlocks: ["Zpráva:", p.message, ""],
    htmlBlocks: [quote("Zpráva", p.message)],
  });
  return {
    to: p.to,
    subject: `Nový kontakt z IG: ${p.contact}`,
    text,
    html,
    // Odpověď z e-mailového klienta půjde rovnou leadovi.
    replyTo: p.hits.find((h) => h.type === "email")?.value,
  };
}

export const RULE_PROMISE = "Slib zákazníkovi: odpověď na IG do 2 dnů.";

export type RuleEmailInput = Common & {
  ruleName: string;
  /** Co bot odpověděl; null = nic neodeslal (např. mimo 24h okno). */
  botReply: string | null;
  botReplyNote?: string;
};

export function buildRuleEmail(p: RuleEmailInput): Email {
  const subject = `IG – ${p.ruleName}: ${p.contact}`;
  const reply = p.botReply ?? `(bot nic neodeslal${p.botReplyNote ? ` – ${p.botReplyNote}` : ""})`;
  const { text, html } = render({
    history: conversation(p),
    cta: INBOX_CTA,
    title: subject,
    rows: [
      ["Účet", esc(`@${p.accountUsername}`)],
      ["Od", esc(p.contact)],
      ["Pravidlo", esc(p.ruleName)],
      ["Čas", esc(fmtTime(p.at))],
    ],
    textBlocks: [`>> ${RULE_PROMISE}`, "", "Zpráva zákazníka:", p.message, "", "Odpověď bota:", reply, ""],
    htmlBlocks: [
      `<p style="margin:0 0 16px;padding:10px 12px;border-radius:8px;background:#fef3c7;color:#78350f;font-weight:600">${esc(RULE_PROMISE)}</p>`,
      quote("Zpráva zákazníka", p.message),
      quote("Odpověď bota", reply),
    ],
  });
  return { to: p.to, subject, text, html };
}

// --- Upozornění na access token ---------------------------------------------------

export type TokenAlertReason = "refresh_failed" | "expiring" | "api_error";

export type TokenEmailInput = {
  to: string;
  accountUsername: string;
  reason: TokenAlertReason;
  expiresAt: Date | null;
  /** Chybová hláška z Instagram API (obnova / odeslání odpovědi). */
  error?: string | null;
  at: Date;
  /** Odkaz na /admin/accounts; bez něj se tlačítko vynechá. */
  adminUrl?: string | null;
};

const TOKEN_TITLES: Record<TokenAlertReason, string> = {
  refresh_failed: "Obnova Instagram tokenu selhala",
  expiring: "Instagram token brzy vyprší",
  api_error: "Instagram odmítl access token – bot neodpovídá",
};

function expiryText(expiresAt: Date | null, now: Date) {
  if (!expiresAt) return "neznámá";
  const days = Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000);
  const rel = expiresAt.getTime() <= now.getTime() ? "už vypršel" : days < 1 ? "méně než 1 den" : `za ${days} ${days === 1 ? "den" : days < 5 ? "dny" : "dní"}`;
  return `${fmtTime(expiresAt)} (${rel})`;
}

export function buildTokenEmail(p: TokenEmailInput): Email {
  const title = `${TOKEN_TITLES[p.reason]}: @${p.accountUsername}`;
  const what =
    p.reason === "api_error"
      ? "Instagram při odesílání odpovědi vrátil chybu tokenu (OAuthException, kód 190). Dokud token nevyměníte, bot na tomto účtu neodpovídá."
      : p.reason === "refresh_failed"
        ? "Automatická obnova tokenu se nepovedla. Zkuste v administraci „Obnovit teď“; pokud to nepomůže, vygenerujte nový token a vložte ho k účtu."
        : "Token se nepodařilo včas prodloužit. Po vypršení bot přestane odpovídat – obnovte ho v administraci, případně vložte nový.";
  const rows: [string, string][] = [
    ["Účet", esc(`@${p.accountUsername}`)],
    ["Platnost tokenu", esc(expiryText(p.expiresAt, p.at))],
    ...(p.error ? [["Chyba", esc(p.error)] as [string, string]] : []),
    ["Čas", esc(fmtTime(p.at))],
  ];
  const { text, html } = render({
    title,
    rows,
    textBlocks: [what, ""],
    htmlBlocks: [`<p style="margin:0 0 16px;padding:10px 12px;border-radius:8px;background:#fee2e2;color:#7f1d1d;font-weight:600">${esc(what)}</p>`],
    cta: p.adminUrl ? { url: p.adminUrl, label: "Otevřít administraci účtů" } : null,
  });
  return { to: p.to, subject: title, text, html };
}
