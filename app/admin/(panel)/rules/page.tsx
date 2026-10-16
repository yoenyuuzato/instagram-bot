import { connection } from "next/server";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, rules } from "@/lib/db/schema";
import { normalizeText } from "@/lib/engine/normalize";
import { toggleRuleAction } from "../../actions";
import { AccountBadge, AccountSwitcher, DbError, makeHref, PageHeader, pillClass } from "../ui";

const SORTS = ["id", "name", "account", "type", "status"] as const;
type SortKey = (typeof SORTS)[number];

export default async function RulesPage({ searchParams }: PageProps<"/admin/rules">) {
  await connection();
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const accountId = Number(sp.account) || null;
  const type = sp.type === "dm" || sp.type === "comment" ? sp.type : null;
  const status = sp.status === "active" || sp.status === "inactive" ? sp.status : null;
  const q = str(sp.q).trim();
  const sort: SortKey | null = SORTS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : null;
  const dir = sp.dir === "desc" ? "desc" : "asc";

  let all, accs;
  try {
    const db = getDb();
    [all, accs] = await Promise.all([
      db
        .select({ rule: rules, username: accounts.username })
        .from(rules)
        .innerJoin(accounts, eq(rules.accountId, accounts.id))
        .orderBy(asc(accounts.username), asc(rules.id)),
      db.select({ id: accounts.id, username: accounts.username }).from(accounts).orderBy(asc(accounts.username)),
    ]);
  } catch (e) {
    return (
      <>
        <PageHeader title="Pravidla" />
        <DbError error={e} />
      </>
    );
  }

  const counts = new Map<number, number>();
  for (const { rule } of all) counts.set(rule.accountId, (counts.get(rule.accountId) ?? 0) + 1);

  const needle = normalizeText(q);
  let rows = all.filter(({ rule }) => {
    if (accountId && rule.accountId !== accountId) return false;
    if (type && rule.triggerType !== type) return false;
    if (status && rule.active !== (status === "active")) return false;
    if (needle) {
      const hay = normalizeText(
        [rule.name, ...rule.keywords, rule.publicReply, rule.dmText, rule.dmButtonTitle].filter(Boolean).join(" "),
      );
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  if (sort) {
    const key = ({ rule, username }: (typeof all)[number]): string | number => {
      switch (sort) {
        case "id":
          return rule.id;
        case "name":
          return rule.name || `Pravidlo #${rule.id}`;
        case "account":
          return username;
        case "type":
          return rule.triggerType === "comment" ? "Komentář" : "DM";
        case "status":
          return rule.active ? 0 : 1;
      }
    };
    const sign = dir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb), "cs");
      return c * sign || a.rule.id - b.rule.id;
    });
  }

  const href = makeHref("/admin/rules", {
    account: accountId ? String(accountId) : null,
    type,
    status,
    q: q || null,
    sort,
    dir: sort ? dir : null,
  });
  const sortHeader = (key: SortKey, label: string) => {
    const activeSort = sort === key;
    const nextDir = activeSort && dir === "asc" ? "desc" : "asc";
    return (
      <th>
        <Link href={href({ sort: key, dir: nextDir })} className="inline-flex items-center gap-1 hover:text-neutral-900">
          {label}
          <span className={activeSort ? "" : "text-neutral-300"}>{activeSort ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </Link>
      </th>
    );
  };
  const filtered = Boolean(accountId || type || status || q);

  return (
    <>
      <PageHeader title="Pravidla">
        <Link href={accountId ? `/admin/rules/new?account=${accountId}` : "/admin/rules/new"} className="btn">
          Nové pravidlo
        </Link>
      </PageHeader>
      <AccountSwitcher accounts={accs} current={accountId} counts={counts} href={(account) => href({ account })} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-500">Typ:</span>
        <Link href={href({ type: null })} className={pillClass(!type)}>
          Vše
        </Link>
        <Link href={href({ type: "dm" })} className={pillClass(type === "dm")}>
          DM
        </Link>
        <Link href={href({ type: "comment" })} className={pillClass(type === "comment")}>
          Komentář
        </Link>
        <span className="mx-2 self-stretch border-l border-neutral-200" />
        <span className="text-sm text-neutral-500">Stav:</span>
        <Link href={href({ status: null })} className={pillClass(!status)}>
          Vše
        </Link>
        <Link href={href({ status: "active" })} className={pillClass(status === "active")}>
          Aktivní
        </Link>
        <Link href={href({ status: "inactive" })} className={pillClass(status === "inactive")}>
          Neaktivní
        </Link>
        <span className="mx-2 self-stretch border-l border-neutral-200" />
        <form action="/admin/rules" className="flex items-center gap-2">
          {accountId && <input type="hidden" name="account" value={accountId} />}
          {type && <input type="hidden" name="type" value={type} />}
          {status && <input type="hidden" name="status" value={status} />}
          {sort && <input type="hidden" name="sort" value={sort} />}
          {sort && <input type="hidden" name="dir" value={dir} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Hledat (název, klíčová slova, odpověď)"
            className="input w-72 py-1"
          />
          <button className="btn-secondary">Hledat</button>
        </form>
        {filtered && (
          <Link href="/admin/rules" className="text-sm text-neutral-500 hover:text-neutral-900">
            Zrušit filtry
          </Link>
        )}
      </div>
      <div className="card overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">{all.length === 0 ? "Zatím žádná pravidla." : "Žádné pravidlo neodpovídá filtru."}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                {sortHeader("id", "ID")}
                {sortHeader("name", "Název")}
                {sortHeader("account", "Účet")}
                {sortHeader("type", "Spouštěč")}
                <th>Klíčová slova</th>
                <th>Akce</th>
                {sortHeader("status", "Stav")}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ rule, username }) => (
                <tr key={rule.id} className={rule.active ? "" : "opacity-50"}>
                  <td className="text-xs text-neutral-500">#{rule.id}</td>
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
                  <td>
                    <AccountBadge id={rule.accountId} username={username} />
                  </td>
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
      {filtered && all.length > 0 && (
        <p className="hint mt-2">
          Zobrazeno {rows.length} z {all.length} pravidel.
        </p>
      )}
    </>
  );
}
