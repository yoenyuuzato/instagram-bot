import { connection } from "next/server";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, rules } from "@/lib/db/schema";
import { toggleRuleAction } from "../../actions";
import { DbError, PageHeader } from "../ui";

export default async function RulesPage() {
  await connection();
  let rows;
  try {
    rows = await getDb()
      .select({ rule: rules, username: accounts.username })
      .from(rules)
      .innerJoin(accounts, eq(rules.accountId, accounts.id))
      .orderBy(asc(accounts.username), asc(rules.id));
  } catch (e) {
    return (
      <>
        <PageHeader title="Pravidla" />
        <DbError error={e} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Pravidla">
        <Link href="/admin/rules/new" className="btn">
          Nové pravidlo
        </Link>
      </PageHeader>
      <div className="card overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">Zatím žádná pravidla.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Název</th>
                <th>Účet</th>
                <th>Spouštěč</th>
                <th>Klíčová slova</th>
                <th>Akce</th>
                <th>Stav</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ rule, username }) => (
                <tr key={rule.id} className={rule.active ? "" : "opacity-50"}>
                  <td className="font-medium">
                    <Link href={`/admin/rules/${rule.id}`} className="hover:underline">
                      {rule.name || `Pravidlo #${rule.id}`}
                    </Link>
                    {rule.notifyOnMatch && (
                      <span
                        className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle text-xs font-medium text-amber-800"
                        title="Při spuštění pošle upozornění e-mailem"
                      >
                        ✉ upozornění
                      </span>
                    )}
                    {rule.postId && <div className="text-xs text-neutral-500">post {rule.postId}</div>}
                  </td>
                  <td>@{username}</td>
                  <td>{rule.triggerType === "comment" ? "Komentář" : "DM"}</td>
                  <td>
                    {rule.keywords.length ? (
                      <div className="flex flex-wrap gap-1">
                        {rule.keywords.map((k) => (
                          <span key={k} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                            {k}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-neutral-400">cokoliv</span>
                    )}
                    <div className="mt-1 text-xs text-neutral-500">
                      {rule.matchMode === "exact" ? "přesná shoda" : "obsahuje"}
                      {rule.maxWords != null && ` · max. ${rule.maxWords} slov`}
                    </div>
                  </td>
                  <td className="text-xs text-neutral-600">
                    {rule.publicReply && <div>Veřejná odpověď</div>}
                    {rule.dmText && <div>DM{rule.dmButtonUrl ? " + tlačítko" : ""}</div>}
                  </td>
                  <td>
                    <form action={toggleRuleAction}>
                      <input type="hidden" name="id" value={rule.id} />
                      <input type="hidden" name="active" value={String(rule.active)} />
                      <button className="btn-secondary">{rule.active ? "Aktivní" : "Vypnuto"}</button>
                    </form>
                  </td>
                  <td className="text-right">
                    <Link href={`/admin/rules/${rule.id}`} className="text-sm text-neutral-500 hover:text-neutral-900">
                      Upravit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
