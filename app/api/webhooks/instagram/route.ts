import { after, type NextRequest } from "next/server";
import { processWebhookPayload } from "@/lib/engine";
import type { WebhookPayload } from "@/lib/engine/types";
import { verifySignature } from "@/lib/webhook-signature";

// after() běží jen do maxDuration. AI odpověď = až 2 volání Gemini po 20 s (2. jen při 429/5xx) + DB + Graph API,
// a jeden webhook může nést víc zpráv zpracovávaných postupně – proto rezerva.
export const maxDuration = 120;

/** Verifikace webhooku při nastavení v Meta App Dashboard. */
export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const expected = process.env.META_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return new Response("Server misconfigured", { status: 500 });

  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Meta chce rychlou 200 – zpracování běží až po odeslání odpovědi.
  after(async () => {
    try {
      await processWebhookPayload(payload);
    } catch (e) {
      console.error("[webhook] zpracování selhalo", e);
    }
  });

  return new Response("EVENT_RECEIVED", { status: 200 });
}
