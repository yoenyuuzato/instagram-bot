import { createHmac, timingSafeEqual } from "node:crypto";

export function signPayload(rawBody: string, appSecret: string) {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
}

/** Ověří hlavičku X-Hub-Signature-256 ("sha256=<hex>") proti raw tělu requestu. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(signPayload(rawBody, appSecret));
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
