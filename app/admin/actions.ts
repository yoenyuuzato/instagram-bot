"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { accounts, rules } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";

export type FormState = { error?: string; ok?: string } | undefined;

async function requireAdmin() {
  const jar = await cookies();
  if (!(await verifySessionToken(jar.get(SESSION_COOKIE)?.value))) redirect("/admin/login");
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;

// --- Přihlášení ---------------------------------------------------------------

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!process.env.ADMIN_PASSWORD) return { error: "Na serveru není nastaveno ADMIN_PASSWORD." };
  if (!(await checkPassword(str(fd, "password")))) return { error: "Nesprávné heslo." };

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  const next = str(fd, "next");
  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/admin/login");
}

// --- Pravidla -----------------------------------------------------------------

function parseRule(fd: FormData) {
  const triggerType = str(fd, "triggerType") === "dm" ? "dm" : "comment";
  const keywords = str(fd, "keywords")
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const dmButtonUrl = opt(fd, "dmButtonUrl");
  const data = {
    accountId: Number(str(fd, "accountId")),
    name: str(fd, "name"),
    triggerType,
    keywords,
    matchMode: str(fd, "matchMode") === "exact" ? "exact" : "contains",
    postId: triggerType === "comment" ? opt(fd, "postId") : null,
    publicReply: triggerType === "comment" ? opt(fd, "publicReply") : null,
    dmText: opt(fd, "dmText"),
    dmButtonUrl,
    dmButtonTitle: dmButtonUrl ? opt(fd, "dmButtonTitle") : null,
    active: fd.get("active") === "on",
  } as const;

  if (!Number.isInteger(data.accountId) || data.accountId <= 0) return { error: "Vyberte účet." };
  if (!data.publicReply && !data.dmText) return { error: "Vyplňte veřejnou odpověď nebo text DM." };
  if (dmButtonUrl && !/^https?:\/\//.test(dmButtonUrl)) return { error: "URL tlačítka musí začínat http(s)://" };
  if (dmButtonUrl && !data.dmText) return { error: "Tlačítko vyžaduje text DM." };
  return { data };
}

export async function saveRuleAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = parseRule(fd);
  if ("error" in parsed) return { error: parsed.error };

  const id = Number(str(fd, "id"));
  const db = getDb();
  if (id) {
    await db.update(rules).set({ ...parsed.data, updatedAt: new Date() }).where(eq(rules.id, id));
  } else {
    await db.insert(rules).values(parsed.data);
  }
  revalidatePath("/admin/rules");
  redirect("/admin/rules");
}

export async function toggleRuleAction(fd: FormData) {
  await requireAdmin();
  const id = Number(fd.get("id"));
  const active = fd.get("active") === "true";
  await getDb().update(rules).set({ active: !active, updatedAt: new Date() }).where(eq(rules.id, id));
  revalidatePath("/admin/rules");
}

export async function deleteRuleAction(fd: FormData) {
  await requireAdmin();
  await getDb().delete(rules).where(eq(rules.id, Number(fd.get("id"))));
  revalidatePath("/admin/rules");
  redirect("/admin/rules");
}

// --- Účty (ruční přidání – OAuth přijde ve fázi 2) ---------------------------

export async function createAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const igUserId = str(fd, "igUserId");
  const username = str(fd, "username").replace(/^@/, "");
  const token = str(fd, "accessToken");
  const expires = str(fd, "tokenExpiresAt");
  if (!/^\d+$/.test(igUserId)) return { error: "IG user ID musí být číslo." };
  if (!username) return { error: "Vyplňte username." };

  let accessToken: string | null = null;
  if (token) {
    if (!process.env.TOKEN_ENCRYPTION_KEY) return { error: "Pro uložení tokenu nastavte TOKEN_ENCRYPTION_KEY." };
    accessToken = encrypt(token);
  }

  try {
    await getDb()
      .insert(accounts)
      .values({ igUserId, username, accessToken, tokenExpiresAt: expires ? new Date(expires) : null });
  } catch {
    return { error: "Účet s tímto IG user ID už existuje." };
  }
  revalidatePath("/admin/accounts");
  return { ok: `Účet @${username} přidán.` };
}

export async function toggleAccountAction(fd: FormData) {
  await requireAdmin();
  const active = fd.get("active") === "true";
  await getDb()
    .update(accounts)
    .set({ active: !active, updatedAt: new Date() })
    .where(eq(accounts.id, Number(fd.get("id"))));
  revalidatePath("/admin/accounts");
}

export async function deleteAccountAction(fd: FormData) {
  await requireAdmin();
  await getDb().delete(accounts).where(eq(accounts.id, Number(fd.get("id"))));
  revalidatePath("/admin/accounts");
}

export async function saveAccountAiAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Neplatný účet." };
  const aiEnabled = fd.get("aiEnabled") === "on";
  const aiSystemPrompt = opt(fd, "aiSystemPrompt");
  if (aiEnabled && !aiSystemPrompt) return { error: "Pro zapnutí AI vyplňte system prompt." };

  await getDb()
    .update(accounts)
    .set({ aiEnabled, aiSystemPrompt, aiFallbackText: opt(fd, "aiFallbackText"), updatedAt: new Date() })
    .where(eq(accounts.id, id));
  revalidatePath("/admin/accounts");
  return { ok: aiEnabled ? "Uloženo – AI odpovědi jsou zapnuté." : "Uloženo – AI odpovědi jsou vypnuté." };
}
