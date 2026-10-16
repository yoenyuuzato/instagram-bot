import Link from "next/link";
import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, eventsLog } from "@/lib/db/schema";
import { AccountBadge, AccountSwitcher, DbError, formatDate, kindLabels, makeHref, PageHeader, pillClass, StatusBadge } from "../ui";

const LIMIT = 200;

export default async function EventsPage({ searchParams }: PageProps<"/admin/events">) {
  const sp = await searchParams;
  const direction = sp.direction === "in" || sp.direction === "out" ? sp.direction : null;
  const accountId = Number(sp.account) || null;

  let rows, accs, countRows;
  try {
    const db = getDb();
    const where: SQL[] = [];
    if (direction) where.push(eq(eventsLog.direction, direction));
    if (accountId) where.push(eq(eventsLog.accountId, accountId));
    [rows, accs, countRows] = await Promise.all([
      db
        .select({ e: eventsLog, username: accounts.username })
        .from(eventsLog)
        .leftJoin(accounts, eq(eventsLog.accountId, accounts.id))
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(eventsLog.createdAt), desc(eventsLog.id))
        .limit(LIMIT),
      db.select({ id: accounts.id, username: accounts.username }).from(accounts).orderBy(asc(accounts.username)),
      db
        .select({ accountId: eventsLog.accountId, n: count() })
        .from(eventsLog)
        .where(direction ? eq(eventsLog.direction, direction) : undefined)
        .groupBy(eventsLog.accountId),
    ]);
  } catch (e) {
    return (
      <>
        <PageHeader title="Log událostí" />
        <DbError error={e} />
      </>
    );
  }

  const href = makeHref("/admin/events", { direction, account: accountId ? String(accountId) : null });
  const pill = pillClass;
  const counts = new Map<number, number>();
  for (const c of countRows) if (c.accountId != null) counts.set(c.accountId, c.n);

  return (
    <>
      <PageHeader title="Log událostí" />
      <AccountSwitcher accounts={accs} current={accountId} counts={counts}
        total={countRows.reduce((a, c) => a + c.n, 0)}
        href={(account) => href({ account })}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={href({ direction: null })} className={pill(!direction)}>
          Vše
        </Link>
        <Link href={href({ direction: "in" })} className={pill(direction === "in")}>
          Příchozí
        </Link>
        <Link href={href({ direction: "out" })} className={pill(direction === "out")}>
          Odchozí
        </Link>
      </div>

      <div className="card overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">Žádné události.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Čas</th>
                <th>Účet</th>
                <th>Typ</th>
                <th>Text</th>
                <th>Stav</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, username }) => (
                <tr key={e.id}>
                  <td className="text-xs whitespace-nowrap text-neutral-500">{formatDate(e.createdAt)}</td>
                  <td className="whitespace-nowrap">{username && e.accountId ? <AccountBadge id={e.accountId} username={username} /> : "—"}</td>
                  <td className="whitespace-nowrap">
                    <span className="mr-1 text-neutral-400">{e.direction === "in" ? "←" : "→"}</span>
                    {kindLabels[e.kind] ?? e.kind}
                    {e.simulated && <span className="ml-1 rounded bg-violet-100 px-1 text-xs text-violet-700">sim</span>}
                  </td>
                  <td className="max-w-xs">
                    <div className="line-clamp-3 break-words">{e.text}</div>
                    {e.contactIgId && <div className="font-mono text-xs text-neutral-400">{e.contactIgId}</div>}
                  </td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="max-w-xs text-xs break-words text-neutral-500">
                    {e.detail}
                    {e.ruleId && <div>pravidlo #{e.ruleId}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows.length === LIMIT && <p className="hint mt-2">Zobrazeno posledních {LIMIT} záznamů.</p>}
    </>
  );
}
