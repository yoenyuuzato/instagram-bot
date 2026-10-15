import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContents, cleanReply, generateReply } from "./gemini";

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
