"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { processWebhookPayload, type EventResult, type WebhookPayload } from "@/lib/engine";
import { signPayload, verifySignature } from "@/lib/webhook-signature";

export type SimulateState =
  | {
      error?: string;
      payload?: WebhookPayload;
      signature?: string | null;
      signatureValid?: boolean | null;
      results?: EventResult[];
    }
  | undefined;

export async function simulateAction(_: SimulateState, fd: FormData): Promise<SimulateState> {
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) return { error: "Nepřihlášen." };

  const get = (k: string) => String(fd.get(k) ?? "").trim();
  const type = get("type") === "dm" ? "dm" : "comment";
  const text = get("text");
  const senderId = get("senderId") || "9000000000000001";
  const username = get("username").replace(/^@/, "") || "testuser";
  const objectId = get("objectId") || `sim_${randomUUID().slice(0, 8)}`;
  const ageHours = Number(get("ageHours")) || 0;
  if (!text) return { error: "Vyplňte text." };

  const [account] = await getDb().select().from(accounts).where(eq(accounts.id, Number(get("accountId")))).limit(1);
  if (!account) return { error: "Vyberte účet." };

  const ts = Date.now() - ageHours * 3600_000;
  const payload: WebhookPayload =
    type === "comment"
      ? {
          object: "instagram",
          entry: [
            {
              id: account.igUserId,
              time: Math.floor(ts / 1000),
              changes: [
                {
                  field: "comments",
                  value: {
                    id: objectId,
                    text,
                    from: { id: senderId, username },
                    media: { id: get("postId") || "sim_media_1", media_product_type: "FEED" },
                  },
                },
              ],
            },
          ],
        }
      : {
          object: "instagram",
          entry: [
            {
              id: account.igUserId,
              time: ts,
              messaging: [
                {
                  sender: { id: senderId },
                  recipient: { id: account.igUserId },
                  timestamp: ts,
                  message: { mid: objectId, text },
                },
              ],
            },
          ],
        };

  // Podepíšeme payload stejně jako Meta – ukazuje, že ověření podpisu sedí.
  const raw = JSON.stringify(payload);
  const secret = process.env.META_APP_SECRET;
  const signature = secret ? signPayload(raw, secret) : null;
  const signatureValid = secret ? verifySignature(raw, signature, secret) : null;

  try {
    const results = await processWebhookPayload(JSON.parse(raw), { simulated: true });
    revalidatePath("/admin/events");
    return { payload, signature, signatureValid, results };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), payload };
  }
}
