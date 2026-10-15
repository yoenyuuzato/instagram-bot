"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { accounts, rules } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { crawlSite, normalizeStartUrl } from "@/lib/knowledge/crawl";
import { buildLeadEmail, isValidEmail, sendEmail } from "@/lib/notify/email";
import { MAX_ICE_BREAKERS, MAX_QUICK_REPLIES, QUICK_REPLY_MAX_CHARS, setIceBreakers } from "@/lib/instagram";
import { refreshTokenNow } from "@/lib/tokens/service";

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
  const shortOnly = fd.get("shortOnly") === "on";
  const quickReplies =
    triggerType === "dm"
      ? str(fd, "quickReplies")
          .split("\n")
          .map((q) => q.trim())
          .filter(Boolean)
      : [];
  const maxWords = Number(str(fd, "maxWords"));
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
    maxWords: shortOnly ? maxWords : null,
    notifyOnMatch: fd.get("notifyOnMatch") === "on",
    quickReplies,
    active: fd.get("active") === "on",
  } as const;

  if (!Number.isInteger(data.accountId) || data.accountId <= 0) return { error: "Vyberte účet." };
  if (!data.publicReply && !data.dmText) return { error: "Vyplňte veřejnou odpověď nebo text DM." };
  if (dmButtonUrl && !/^https?:\/\//.test(dmButtonUrl)) return { error: "URL tlačítka musí začínat http(s)://" };
  if (dmButtonUrl && !data.dmText) return { error: "Tlačítko vyžaduje text DM." };
  if (quickReplies.length > MAX_QUICK_REPLIES) return { error: `Quick replies: max. ${MAX_QUICK_REPLIES} tlačítek.` };
  const tooLong = quickReplies.find((q) => [...q].length > QUICK_REPLY_MAX_CHARS);
  if (tooLong) return { error: `Quick reply „${tooLong}“ je delší než ${QUICK_REPLY_MAX_CHARS} znaků.` };
  if (quickReplies.length && !data.dmText) return { error: "Quick replies vyžadují text DM." };
  if (shortOnly && !(Number.isInteger(maxWords) && maxWords >= 1 && maxWords <= 50)) {
    return { error: "Max. počet slov musí být celé číslo 1–50." };
  }
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

/** Stáhne web klienta do znalostní báze účtu. Běží až ~50 s – stránka /admin/accounts má maxDuration 60. */
export async function crawlKnowledgeAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Neplatný účet." };

  let url: string;
  try {
    const u = normalizeStartUrl(str(fd, "knowledgeUrl"));
    if (!u.hostname.includes(".")) throw new Error();
    url = u.toString();
  } catch {
    return { error: "Zadejte platnou URL webu, např. https://topprofitdesign.cz" };
  }

  const db = getDb();
  await db.update(accounts).set({ knowledgeUrl: url, updatedAt: new Date() }).where(eq(accounts.id, id));
  try {
    const res = await crawlSite(url);
    await db
      .update(accounts)
      .set({ knowledgeText: res.text, knowledgeUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(accounts.id, id));
    revalidatePath("/admin/accounts");
    const robots = res.skipped.filter((s) => s.reason.includes("robots")).length;
    const notes = [
      res.source === "sitemap" ? "ze sitemap.xml" : "z odkazů na homepage",
      res.truncated && "zkráceno na limit znaků",
      res.skipped.length > 0 && `přeskočeno ${res.skipped.length}${robots ? ` (robots.txt: ${robots})` : ""}`,
    ].filter(Boolean);
    return { ok: `Načteno ${res.pages.length} stránek, ${res.text.length.toLocaleString("cs-CZ")} znaků (${notes.join(", ")}).` };
  } catch (e) {
    revalidatePath("/admin/accounts");
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Uloží e-mail pro upozornění na leady; s intent=test navíc pošle ukázkové upozornění. */
export async function saveNotifyEmailAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Neplatný účet." };
  const notifyEmail = str(fd, "notifyEmail");
  const test = str(fd, "intent") === "test";
  if (notifyEmail && !isValidEmail(notifyEmail)) return { error: "Neplatný e-mail." };
  if (test && !notifyEmail) return { error: "Vyplňte e-mail pro upozornění." };

  const db = getDb();
  const [account] = await db
    .update(accounts)
    .set({ notifyEmail: notifyEmail || null, updatedAt: new Date() })
    .where(eq(accounts.id, id))
    .returning({ username: accounts.username });
  if (!account) return { error: "Účet nenalezen." };
  revalidatePath("/admin/accounts");
  if (!test) return { ok: notifyEmail ? "Uloženo – upozornění na leady jsou zapnutá." : "Uloženo – upozornění jsou vypnutá." };

  const now = new Date();
  const res = await sendEmail(
    buildLeadEmail({
      to: notifyEmail,
      accountUsername: account.username,
      contact: "@testovaci_kontakt",
      hits: [
        { type: "email", value: "jana.novakova@example.com", raw: "jana.novakova@example.com" },
        { type: "phone", value: "+420777123456", raw: "777 123 456" },
      ],
      message: "Dobrý den, mám zájem o nový web. Můj e-mail je jana.novakova@example.com, tel. 777 123 456.",
      history: [
        { role: "user", text: "Ahoj, děláte i e-shopy?", at: new Date(now.getTime() - 120_000) },
        { role: "model", text: "Ahoj! Ano, stavíme e-shopy na míru. Nechceš mi poslat e-mail, ať se ti ozveme?", at: new Date(now.getTime() - 110_000) },
        { role: "user", text: "Dobrý den, mám zájem o nový web. Můj e-mail je jana.novakova@example.com, tel. 777 123 456.", at: now },
      ],
      at: now,
    }),
  );
  if (!res.ok) return { error: `Uloženo, ale testovací e-mail se neodeslal: ${res.error}` };
  return { ok: `Testovací e-mail odeslán na ${notifyEmail} (Resend id ${res.id}).` };
}

/** Ice breakers: uloží otázky; s intent=apply je nastaví i na Instagramu (messenger_profile). */
export async function saveIceBreakersAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Neplatný účet." };
  const questions = fd
    .getAll("iceBreaker")
    .map((q) => String(q).trim())
    .filter(Boolean);
  if (questions.length > MAX_ICE_BREAKERS) return { error: `Max. ${MAX_ICE_BREAKERS} otázky.` };
  const tooLong = questions.find((q) => [...q].length > 80);
  if (tooLong) return { error: `Otázka „${tooLong.slice(0, 30)}…“ je příliš dlouhá (max. 80 znaků).` };

  const db = getDb();
  const [account] = await db
    .update(accounts)
    .set({ iceBreakers: questions, updatedAt: new Date() })
    .where(eq(accounts.id, id))
    .returning();
  if (!account) return { error: "Účet nenalezen." };
  revalidatePath("/admin/accounts");
  if (str(fd, "intent") !== "apply") return { ok: "Otázky uloženy (na Instagramu zatím nezměněny)." };

  let accessToken: string | null = null;
  try {
    accessToken = account.accessToken ? decrypt(account.accessToken) : null;
  } catch {
    return { error: "Uloženo, ale access token účtu nejde dešifrovat (TOKEN_ENCRYPTION_KEY)." };
  }
  const res = await setIceBreakers(account.igUserId, questions, { accessToken });
  if (!res.ok) return { error: `Uloženo, ale Instagram odmítl: ${res.error}` };
  const what = questions.length ? `Nastaveno ${questions.length} otázek` : "Ice breakers smazány";
  return { ok: res.mock ? `${what} – MOCK režim, na Instagram se nic neposlalo (INSTAGRAM_MOCK).` : `${what} na Instagramu.` };
}

/** „Obnovit teď“ – prodlouží long-lived token o 60 dní (Instagram vyžaduje token starší než 24 h a nevypršelý). */
export async function refreshTokenAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Neplatný účet." };
  const res = await refreshTokenNow(id);
  revalidatePath("/admin/accounts");
  if (!res.ok) return { error: `Obnova selhala: ${res.error}` };
  const until = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeZone: "Europe/Prague" }).format(res.expiresAt);
  return { ok: `Obnoveno, platí do ${until}.` };
}
