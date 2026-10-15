import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeadEmail, INBOX_URL, notifyFrom, sendEmail } from "./email";

const input = {
  to: "obchod@firma.cz",
  accountUsername: "topprofitdesign",
  contactLabel: "jana",
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
