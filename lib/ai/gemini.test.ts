import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContents, cleanReply, generateReply, thinkingConfigFor } from "./gemini";

test("cleanReply: odstraní markdown", () => {
  assert.equal(cleanReply("**Ahoj!** Mrkni na [web](https://topprofitdesign.cz)."), "Ahoj! Mrkni na web https://topprofitdesign.cz.");
  assert.equal(cleanReply("## Nadpis\n- jedna\n- dvě\n`kód`"), "Nadpis\njedna\ndvě\nkód");
  assert.equal(cleanReply("Tohle je *důležité* a moje_url_s_podtrzitky"), "Tohle je důležité a moje_url_s_podtrzitky");
});

test("cleanReply: zkrácení na max délku, nejlépe na konci věty", () => {
  const long = "Krátká věta. ".repeat(80);
  const out = cleanReply(long);
  assert.ok(out.length <= 600);
  assert.ok(out.endsWith("."));
  const noSentence = "a".repeat(700);
  assert.equal(cleanReply(noSentence).length, 600);
  assert.ok(cleanReply(noSentence).endsWith("…"));
});

test("buildContents: slučuje stejné role a začíná uživatelem", () => {
  const c = buildContents([
    { role: "model", text: "stará odpověď" },
    { role: "user", text: "ahoj" },
    { role: "user", text: "kolik stojí web?" },
    { role: "model", text: "záleží na rozsahu" },
    { role: "user", text: " " },
    { role: "user", text: "ok, díky" },
  ]);
  assert.deepEqual(
    c.map((x) => [x.role, x.parts[0].text]),
    [
      ["user", "ahoj\nkolik stojí web?"],
      ["model", "záleží na rozsahu"],
      ["user", "ok, díky"],
    ],
  );
});

test("generateReply bez API klíče vrátí chybu, nevyhazuje", async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const r = await generateReply("prompt", [{ role: "user", text: "ahoj" }]);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /GEMINI_API_KEY/);
  if (prev) process.env.GEMINI_API_KEY = prev;
});

test("thinkingConfigFor: minimální přemýšlení podle modelu", () => {
  const prev = process.env.GEMINI_THINKING_LEVEL;
  delete process.env.GEMINI_THINKING_LEVEL;
  assert.deepEqual(thinkingConfigFor("gemini-3.8-flash"), { thinkingLevel: "low" });
  assert.deepEqual(thinkingConfigFor("models/gemini-3-pro-preview"), { thinkingLevel: "low" });
  assert.deepEqual(thinkingConfigFor("gemini-2.5-flash"), { thinkingBudget: 0 });
  assert.deepEqual(thinkingConfigFor("gemini-2.5-flash-lite"), { thinkingBudget: 0 });
  assert.deepEqual(thinkingConfigFor("gemini-2.5-pro"), { thinkingBudget: 128 });
  assert.equal(thinkingConfigFor("gemini-2.0-flash"), undefined);
  process.env.GEMINI_THINKING_LEVEL = "minimal";
  assert.deepEqual(thinkingConfigFor("gemini-3.6-flash"), { thinkingLevel: "minimal" });
  if (prev) process.env.GEMINI_THINKING_LEVEL = prev;
  else delete process.env.GEMINI_THINKING_LEVEL;
});

test("generateReply: timeout se neopakuje, 429/5xx ano", async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  const prevFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test";
  const history = [{ role: "user" as const, text: "ahoj" }];
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      throw new DOMException("timeout", "TimeoutError");
    };
    let r = await generateReply("p", history);
    assert.equal(calls, 1);
    assert.equal(r.attempts, 1);
    assert.match(r.error ?? "", /Timeout 20 s/);

    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return Response.json({ error: { message: "quota" } }, { status: 429 });
      return Response.json({ candidates: [{ content: { parts: [{ text: "**Ahoj!**" }] } }] });
    };
    r = await generateReply("p", history);
    assert.equal(calls, 2);
    assert.deepEqual([r.ok, r.text, r.attempts], [true, "Ahoj!", 2]);

    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ error: { message: "bad" } }, { status: 400 });
    };
    r = await generateReply("p", history);
    assert.equal(calls, 1);
    assert.equal(r.ok, false);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});
