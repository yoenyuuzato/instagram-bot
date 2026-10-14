import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

// AES-256-GCM, formát: v1:<iv b64>:<tag b64>:<ciphertext b64>
function key() {
  return createHash("sha256").update(env.required("TOKEN_ENCRYPTION_KEY")).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ct] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Neplatný formát šifrovaného tokenu");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}
