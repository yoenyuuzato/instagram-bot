import { test } from "node:test";
import assert from "node:assert/strict";
import { isTokenError, quickRepliesPayload, refreshAccessToken, sendDirectMessage, sendSenderAction, setIceBreakers } from "./instagram";

const mock = { accessToken: null, forceMock: true };

test("quick replies: max 13, titulek max 20 znaků, payload = celý text", () => {
  assert.equal(quickRepliesPayload([]), undefined);
  assert.equal(quickRepliesPayload(Array.from({ length: 20 }, (_, i) => `q${i}`))!.length, 13);
  const [q] = quickRepliesPayload(["💰 Ceník a všechny služby včetně SEO"])!;
  assert.equal(q.content_type, "text");
  assert.equal([...q.title].length, 20);
  assert.equal(q.payload, "💰 Ceník a všechny služby včetně SEO");
});

test("DM s quick replies – tvar requestu", async () => {
  const r = await sendDirectMessage("acc", "u1", { text: "Vyber:", quickReplies: ["💰 Ceník", " ", "👤 Člověk"] }, mock);
  assert.deepEqual(r.request.body, {
    recipient: { id: "u1" },
    message: {
      text: "Vyber:",
      quick_replies: [
        { content_type: "text", title: "💰 Ceník", payload: "💰 Ceník" },
        { content_type: "text", title: "👤 Člověk", payload: "👤 Člověk" },
      ],
    },
  });
});

test("sender_action typing_on – jen recipient + sender_action", async () => {
  const r = await sendSenderAction("acc", "u1", "typing_on", mock);
  assert.deepEqual(r.request, { method: "POST", path: "/acc/messages", body: { recipient: { id: "u1" }, sender_action: "typing_on" } });
});

test("ice breakers – nastavení (max 4) a smazání", async () => {
  const set = await setIceBreakers("acc", ["A?", "B?", "", "C?", "D?", "E?"], mock);
  assert.equal(set.request.path, "/acc/messenger_profile");
  assert.deepEqual(set.request.body, {
    platform: "instagram",
    ice_breakers: [
      {
        call_to_actions: ["A?", "B?", "C?", "D?"].map((q) => ({ question: q, payload: q })),
        locale: "default",
      },
    ],
  });
  const del = await setIceBreakers("acc", [], mock);
  assert.deepEqual(del.request, { method: "DELETE", path: "/acc/messenger_profile", body: { fields: ["ice_breakers"] } });
});

test("refreshAccessToken: GET graph.instagram.com/refresh_access_token, nový token a expirace", async () => {
  const now = new Date("2026-10-15T06:00:00Z");
  let url = "";
  const r = await refreshAccessToken("OLD", now, async (u, init) => {
    url = String(u);
    assert.equal(init?.method ?? "GET", "GET");
    return Response.json({ access_token: "NEW", token_type: "bearer", expires_in: 5_184_000 });
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://graph.instagram.com/refresh_access_token");
  assert.deepEqual([u.searchParams.get("grant_type"), u.searchParams.get("access_token")], ["ig_refresh_token", "OLD"]);
  assert.deepEqual(r, { ok: true, accessToken: "NEW", expiresAt: new Date(now.getTime() + 60 * 86_400_000) });
});

test("refreshAccessToken: chyba 190 → tokenError, jiná chyba bez něj", async () => {
  const err = (code: number) => async () =>
    Response.json({ error: { message: "Error validating access token", type: "OAuthException", code } }, { status: 400 });
  assert.deepEqual(await refreshAccessToken("X", new Date(), err(190)), { ok: false, error: "Error validating access token", tokenError: true });
  assert.deepEqual(await refreshAccessToken("X", new Date(), err(4)), { ok: false, error: "Error validating access token" });
  const broken = await refreshAccessToken("X", new Date(), async () => Response.json({ token_type: "bearer" }));
  assert.equal(broken.ok, false);
  const down = await refreshAccessToken("X", new Date(), async () => {
    throw new Error("ECONNRESET");
  });
  assert.deepEqual(down, { ok: false, error: "ECONNRESET" });
});

test("isTokenError: jen kód 190", () => {
  assert.equal(isTokenError({ type: "OAuthException", code: 190 }), true);
  assert.equal(isTokenError({ type: "OAuthException", code: 10 }), false);
  assert.equal(isTokenError(undefined), false);
});

test("odeslání DM: chyba 190 z Graph API → tokenError", async () => {
  const prevMock = process.env.INSTAGRAM_MOCK;
  const prevFetch = globalThis.fetch;
  process.env.INSTAGRAM_MOCK = "false";
  globalThis.fetch = async () =>
    Response.json({ error: { message: "Session has expired", type: "OAuthException", code: 190, error_subcode: 463 } }, { status: 400 });
  try {
    const r = await sendDirectMessage("acc", "u1", { text: "Ahoj" }, { accessToken: "T" });
    assert.deepEqual([r.ok, r.tokenError, r.error], [false, true, "Session has expired"]);
    globalThis.fetch = async () => Response.json({ error: { message: "Rate limit", code: 4 } }, { status: 400 });
    const other = await sendDirectMessage("acc", "u1", { text: "Ahoj" }, { accessToken: "T" });
    assert.equal(other.tokenError, undefined);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevMock === undefined) delete process.env.INSTAGRAM_MOCK;
    else process.env.INSTAGRAM_MOCK = prevMock;
  }
});
