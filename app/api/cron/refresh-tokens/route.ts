import type { NextRequest } from "next/server";
import { refreshExpiringTokens } from "@/lib/tokens/service";

// Pár účtů × (refresh ~1 s + e-mail) – rezerva.
export const maxDuration = 60;

/**
 * Denní obnova Instagram tokenů (Vercel Cron, viz vercel.json).
 * Vercel posílá `Authorization: Bearer $CRON_SECRET`, když je CRON_SECRET nastaven v projektu.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Server misconfigured: CRON_SECRET", { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

  const results = await refreshExpiringTokens();
  const summary = results.map((r) => ({ ...r, expiresAt: r.expiresAt?.toISOString() ?? null }));
  console.log("[cron] refresh-tokens", JSON.stringify(summary));
  return Response.json({ ok: true, results: summary });
}
