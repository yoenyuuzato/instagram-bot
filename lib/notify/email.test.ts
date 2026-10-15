import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeadEmail, buildRuleEmail, buildTokenEmail, contactDisplay, INBOX_URL, notifyFrom, RULE_PROMISE, sendEmail } from "./email";

const input = {
  to: "obchod@firma.cz",
  accountUsername: "topprofitdesign",
  contact: "@jana",
  hits: [
    { type: "email" as const, value: "jana@example.com", raw: "jana@example.com" },
    { type: "phone" as const, value: "+420777123456", raw: "777 123 456" },
  ],
  message: "Mám zájem <b>o web</b>, jana@example.com",
  history: [
    { role: "user" as const, text: "Ahoj", at: new Date("2026-10-15T08:00:00Z") },
    { role: "model" as const, text: "Ahoj! Jak pomůžu?", at: new Date("2026-10-15T08:00:05Z") },
  ],
  at: new Date("2026-10-15T08:01:00Z"),
};

test("buildLeadEmail: předmět, kontakt, zpráva, historie, odkaz, reply-to", () => {
  const e = buildLeadEmail(input);
  assert.equal(e.subject, "Nový kontakt z IG: @jana");
  assert.equal(e.replyTo, "jana@example.com");
  for (const s of ["E-mail: jana@example.com", "Telefon: +420 777 123 456", "Mám zájem <b>o web</b>", "@topprofitdesign (bot): Ahoj! Jak pomůžu?", INBOX_URL, "10:01"]) {
    assert.ok(e.text.includes(s), s);
  }
  assert.ok(e.html.includes("&lt;b&gt;o web&lt;/b&gt;"), "HTML escapování");
  assert.ok(!e.html.includes("<b>o web</b>"));
  assert.ok(e.html.includes('href="tel:+420777123456"'));
});

test("sendEmail bez RESEND_API_KEY nepadá", async () => {
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const r = await sendEmail(buildLeadEmail(input));
    assert.deepEqual([r.ok, r.skipped], [false, true]);
  } finally {
    console.warn = warn;
    if (prev) process.env.RESEND_API_KEY = prev;
  }
});

test("sendEmail: tvar požadavku na Resend", async () => {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "re_test";
  let req: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = async (url, init) => {
    req = { url: String(url), init: init! };
    return Response.json({ id: "abc" });
  };
  try {
    const r = await sendEmail(buildLeadEmail(input));
    assert.deepEqual(r, { ok: true, id: "abc" });
    assert.equal(req!.url, "https://api.resend.com/emails");
    assert.equal((req!.init.headers as Record<string, string>).Authorization, "Bearer re_test");
    const body = JSON.parse(String(req!.init.body));
    assert.deepEqual([body.from, body.to, body.reply_to], [notifyFrom(), ["obchod@firma.cz"], "jana@example.com"]);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey) process.env.RESEND_API_KEY = prevKey;
    else delete process.env.RESEND_API_KEY;
  }
});

test("contactDisplay: @username, jinak IG ID", () => {
  assert.equal(contactDisplay("jana", "123"), "@jana");
  assert.equal(contactDisplay(null, "17841400000000001"), "IG ID 17841400000000001");
});

test("buildRuleEmail: předmět s názvem pravidla, zpráva, odpověď bota, slib, historie", () => {
  const base = { ...input, contact: "IG ID 999", ruleName: "Chci mluvit s člověkem" };
  const e = buildRuleEmail({ ...base, botReply: "Jasně, ozve se ti kolega <do 2 dnů>." });
  assert.equal(e.subject, "IG – Chci mluvit s člověkem: IG ID 999");
  assert.equal(e.replyTo, undefined);
  for (const s of [RULE_PROMISE, "Zpráva zákazníka:", input.message, "Odpověď bota:", "Jasně, ozve se ti kolega <do 2 dnů>.", "IG ID 999: Ahoj", INBOX_URL]) {
    assert.ok(e.text.includes(s), s);
  }
  assert.ok(e.html.includes("Slib zákazníkovi: odpověď na IG do 2 dnů."));
  assert.ok(e.html.includes("&lt;do 2 dnů&gt;"));

  const none = buildRuleEmail({ ...base, botReply: null, botReplyNote: "Mimo 24h okno" });
  assert.ok(none.text.includes("(bot nic neodeslal – Mimo 24h okno)"));
});

test("buildTokenEmail: chyba API – předmět, platnost, chyba, odkaz do adminu, escapování", () => {
  const at = new Date("2026-10-15T08:00:00Z");
  const e = buildTokenEmail({
    to: "obchod@firma.cz",
    accountUsername: "topprofitdesign",
    reason: "api_error",
    expiresAt: new Date("2026-10-18T08:00:00Z"),
    error: "Session has expired <x>",
    at,
    adminUrl: "https://bot.example.com/admin/accounts",
  });
  assert.equal(e.subject, "Instagram odmítl access token – bot neodpovídá: @topprofitdesign");
  assert.equal(e.to, "obchod@firma.cz");
  for (const s of ["OAuthException, kód 190", "Platnost tokenu:", "(za 3 dny)", "Chyba: Session has expired <x>", "https://bot.example.com/admin/accounts"]) {
    assert.ok(e.text.includes(s), s);
  }
  assert.ok(e.html.includes("Session has expired &lt;x&gt;"));
  assert.ok(!e.text.includes("Posledních"), "bez historie konverzace");
});

test("buildTokenEmail: obnova selhala / brzy vyprší, bez adminUrl bez tlačítka", () => {
  const at = new Date("2026-10-15T08:00:00Z");
  const failed = buildTokenEmail({ to: "a@b.cz", accountUsername: "x", reason: "refresh_failed", expiresAt: null, error: "boom", at });
  assert.equal(failed.subject, "Obnova Instagram tokenu selhala: @x");
  assert.ok(failed.text.includes("Platnost tokenu: neznámá"));
  assert.ok(!failed.html.includes("<a href"));
  const expiring = buildTokenEmail({ to: "a@b.cz", accountUsername: "x", reason: "expiring", expiresAt: new Date("2026-10-14T08:00:00Z"), at });
  assert.equal(expiring.subject, "Instagram token brzy vyprší: @x");
  assert.ok(expiring.text.includes("už vypršel"));
});
