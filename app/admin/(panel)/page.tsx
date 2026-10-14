import { connection } from "next/server";
import Link from "next/link";
import { count, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, eventsLog, rules } from "@/lib/db/schema";
import { DbError, PageHeader } from "./ui";

export default async function Dashboard() {
  await connection();
  let stats;
  try {
    const db = getDb();
    const [[a], [r], [e], [s]] = await Promise.all([
      db.select({ n: count() }).from(accounts),
      db.select({ n: count() }).from(rules).where(eq(rules.active, true)),
      db.select({ n: count() }).from(eventsLog).where(gte(eventsLog.createdAt, sql`now() - interval '24 hours'`)),
      db.select({ n: count() }).from(eventsLog).where(eq(eventsLog.status, "sent")),
    ]);
    const last = await db.select().from(eventsLog).orderBy(desc(eventsLog.createdAt)).limit(1);
    stats = { accounts: a.n, rules: r.n, events24h: e.n, sent: s.n, last: last[0] };
  } catch (err) {
    return (
      <>
        <PageHeader title="Přehled" />
        <DbError error={err} />
      </>
    );
  }

  const tiles = [
    { label: "Účty", value: stats.accounts, href: "/admin/accounts" },
    { label: "Aktivní pravidla", value: stats.rules, href: "/admin/rules" },
    { label: "Události za 24 h", value: stats.events24h, href: "/admin/events" },
    { label: "Odeslané odpovědi", value: stats.sent, href: "/admin/events?direction=out" },
  ];

  return (
    <>
      <PageHeader title="Přehled" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card hover:border-neutral-400">
            <div className="text-sm text-neutral-500">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold">{t.value}</div>
          </Link>
        ))}
      </div>
      <div className="card mt-6 text-sm text-neutral-600">
        <p>
          Fáze 1 běží bez napojení na Meta. Pravidla otestujete v{" "}
          <Link href="/admin/simulate" className="underline">
            simulátoru
          </Link>
          . Webhook endpoint: <code className="font-mono">/api/webhooks/instagram</code>
        </p>
      </div>
    </>
  );
}
