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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }).format(d);

export type LeadEmailInput = {
  to: string;
  accountUsername: string;
  /** IG username kontaktu, pokud ho známe – jinak IG scoped ID. */
  contactLabel: string;
  hits: ContactHit[];
  message: string;
  history: { role: "user" | "model"; text: string; at: Date }[];
  at: Date;
};

export function buildLeadEmail(p: LeadEmailInput): Email {
  const label = (h: ContactHit) => (h.type === "email" ? h.value : formatPhone(h.value));
  const found = p.hits.map((h) => `${h.type === "email" ? "E-mail" : "Telefon"}: ${label(h)}`);
  const who = (r: "user" | "model") => (r === "user" ? `@${p.contactLabel}` : `@${p.accountUsername} (bot)`);

  const text = [
    `Nový kontakt z Instagramu (@${p.accountUsername})`,
    "",
    `Od: @${p.contactLabel}`,
    `Čas: ${fmtTime(p.at)}`,
    ...found,
    "",
    "Zpráva:",
    p.message,
    "",
    `Posledních ${p.history.length} zpráv konverzace:`,
    ...p.history.map((m) => `[${fmtTime(m.at)}] ${who(m.role)}: ${m.text}`),
    "",
    `Odpovědět: ${INBOX_URL}`,
  ].join("\n");

  const contactHtml = p.hits
    .map((h) => {
      const v = esc(label(h));
      const href = h.type === "email" ? `mailto:${esc(h.value)}` : `tel:${esc(h.value)}`;
      return `<tr><td style="padding:2px 12px 2px 0;color:#666">${h.type === "email" ? "E-mail" : "Telefon"}</td><td><a href="${href}" style="font-weight:600">${v}</a></td></tr>`;
    })
    .join("");
  const historyHtml = p.history
    .map(
      (m) =>
        `<div style="margin:6px 0;padding:8px 10px;border-radius:8px;background:${m.role === "user" ? "#f3f4f6" : "#eef2ff"}">` +
        `<div style="font-size:12px;color:#666">${esc(who(m.role))} · ${esc(fmtTime(m.at))}</div>` +
        `<div style="white-space:pre-wrap">${esc(m.text)}</div></div>`,
    )
    .join("");

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#111;max-width:600px">
<h2 style="font-size:18px;margin:0 0 12px">Nový kontakt z IG: @${esc(p.contactLabel)}</h2>
<table style="border-collapse:collapse;margin-bottom:12px">
<tr><td style="padding:2px 12px 2px 0;color:#666">Účet</td><td>@${esc(p.accountUsername)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Čas</td><td>${esc(fmtTime(p.at))}</td></tr>
${contactHtml}
</table>
<p style="margin:0 0 4px;color:#666">Zpráva</p>
<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #111;white-space:pre-wrap">${esc(p.message)}</blockquote>
<p style="margin:0 0 4px;color:#666">Posledních ${p.history.length} zpráv konverzace</p>
${historyHtml}
<p style="margin-top:16px"><a href="${INBOX_URL}" style="display:inline-block;padding:8px 14px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Otevřít Instagram Direct</a></p>
</div>`;

  return {
    to: p.to,
    subject: `Nový kontakt z IG: @${p.contactLabel}`,
    text,
    html,
    // Odpověď z e-mailového klienta půjde rovnou leadovi.
    replyTo: p.hits.find((h) => h.type === "email")?.value,
  };
}
