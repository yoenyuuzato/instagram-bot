import { test } from "node:test";
import assert from "node:assert/strict";
import { quickRepliesPayload, sendDirectMessage, sendSenderAction, setIceBreakers } from "./instagram";

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
