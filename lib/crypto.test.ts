import { test } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt } from "./crypto";

test("šifrování tokenu (AES-256-GCM) – roundtrip a detekce manipulace", () => {
  process.env.TOKEN_ENCRYPTION_KEY = "test-key";
  const enc = encrypt("IGAAtoken123");
  assert.notEqual(enc, "IGAAtoken123");
  assert.equal(decrypt(enc), "IGAAtoken123");
  const parts = enc.split(":");
  parts[3] = Buffer.from("x").toString("base64");
  assert.throws(() => decrypt(parts.join(":")));
});
