import { connection } from "next/server";
import { asc, count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, rules } from "@/lib/db/schema";
import { deleteAccountAction, toggleAccountAction } from "../../actions";
import { ConfirmButton } from "../confirm-button";
import { DbError, formatDate, PageHeader } from "../ui";
import { AccountForm } from "./account-form";

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
      <AccountForm />
    </>
  );
}
