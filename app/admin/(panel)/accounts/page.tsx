import { connection } from "next/server";
import { asc, count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, rules } from "@/lib/db/schema";
import { deleteAccountAction, toggleAccountAction } from "../../actions";
import { ConfirmButton } from "../confirm-button";
import { DbError, formatDate, PageHeader } from "../ui";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { AccountForm } from "./account-form";
import { AiSettingsForm } from "./ai-settings-form";
import { KnowledgeForm } from "./knowledge-form";

// Server Action "Načíst / Obnovit web" stahuje až 30 stránek.
export const maxDuration = 60;

function isExpired(d: Date | null) {
  return !!d && d.getTime() < Date.now();
}

export default async function AccountsPage() {
  await connection();
  let rows;
  try {
    rows = await getDb()
      .select({ account: accounts, ruleCount: count(rules.id) })
      .from(accounts)
      .leftJoin(rules, eq(rules.accountId, accounts.id))
      .groupBy(accounts.id)
      .orderBy(asc(accounts.username));
  } catch (e) {
    return (
      <>
        <PageHeader title="Účty" />
        <DbError error={e} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Účty" />
      <div className="card mb-6 overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">Zatím žádné účty.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Účet</th>
                <th>IG user ID</th>
                <th>Token</th>
                <th>Platnost tokenu</th>
                <th>Pravidla</th>
                <th>AI</th>
                <th>Stav</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ account: a, ruleCount }) => {
                const expired = isExpired(a.tokenExpiresAt);
                return (
                  <tr key={a.id} className={a.active ? "" : "opacity-50"}>
                    <td className="font-medium">@{a.username}</td>
                    <td className="font-mono text-xs">{a.igUserId}</td>
                    <td>{a.accessToken ? "uložen (šifrovaně)" : <span className="text-neutral-400">chybí</span>}</td>
                    <td className={expired ? "text-red-600" : ""}>{formatDate(a.tokenExpiresAt)}</td>
                    <td>{ruleCount}</td>
                    <td>{a.aiEnabled ? "zapnuto" : <span className="text-neutral-400">vypnuto</span>}</td>
                    <td>
                      <form action={toggleAccountAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="active" value={String(a.active)} />
                        <button className="btn-secondary">{a.active ? "Aktivní" : "Vypnuto"}</button>
                      </form>
                    </td>
                    <td className="text-right">
                      <form action={deleteAccountAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <ConfirmButton message={`Smazat účet @${a.username} včetně jeho pravidel?`}>Smazat</ConfirmButton>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {rows.length > 0 && (
        <section className="mb-6 space-y-4">
          <div>
            <h2 className="font-medium">AI odpovědi (Google Gemini)</h2>
            <p className="hint max-w-2xl">
              AI odpovídá jen na DM, které nesedí na žádné pravidlo – klíčová pravidla mají vždy přednost. Platí 24h okno a limit 1
              odpověď na kontakt za 10 s, max. 30 za hodinu. Vyzkoušet bez odeslání na Instagram jde v Simulátoru.
            </p>
          </div>
          {rows.map(({ account: a }) => (
            <div key={a.id} className="card max-w-3xl space-y-6">
              <AiSettingsForm
                id={a.id}
                username={a.username}
                aiEnabled={a.aiEnabled}
                aiSystemPrompt={a.aiSystemPrompt ?? DEFAULT_SYSTEM_PROMPT}
                aiFallbackText={a.aiFallbackText ?? ""}
              />
              <KnowledgeForm
                id={a.id}
                url={a.knowledgeUrl ?? ""}
                updatedAt={a.knowledgeUpdatedAt ? formatDate(a.knowledgeUpdatedAt) : null}
                chars={a.knowledgeText?.length ?? 0}
                preview={a.knowledgeText?.slice(0, 500) ?? ""}
              />
            </div>
          ))}
        </section>
      )}
      <AccountForm />
    </>
  );
}
