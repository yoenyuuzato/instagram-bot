import { connection } from "next/server";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, contacts, type Contact } from "@/lib/db/schema";
import { isBotPaused } from "@/lib/engine/takeover";
import { setContactBotAction } from "../../actions";
import { DbError, formatDate, PageHeader } from "../ui";

const RECENT_LIMIT = 50;

type Row = { c: Contact; username: string | null };

export default async function ContactsPage() {
  await connection();
  const now = new Date();
  let paused: Row[], recent: Row[];
  try {
    const db = getDb();
    const base = () =>
      db.select({ c: contacts, username: accounts.username }).from(contacts).leftJoin(accounts, eq(contacts.accountId, accounts.id));
    [paused, recent] = await Promise.all([
      base()
        .where(or(eq(contacts.botPausedPermanent, true), gt(contacts.botPausedUntil, now)))
        .orderBy(desc(contacts.botPausedPermanent), desc(contacts.botPausedUntil)),
      base()
        .where(and(eq(contacts.botPausedPermanent, false), or(isNull(contacts.botPausedUntil), lte(contacts.botPausedUntil, now))))
        .orderBy(sql`${contacts.lastInteractionAt} desc nulls last`, desc(contacts.id))
        .limit(RECENT_LIMIT),
    ]);
  } catch (e) {
    return (
      <>
        <PageHeader title="Kontakty" />
        <DbError error={e} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Kontakty" />
      <p className="hint mb-6 max-w-2xl">
        Bot u kontaktu nereaguje na DM (pravidla ani AI), když je pauza aktivní. Pauzu spustí vaše ruční odpověď v DM (délka
        se nastavuje u účtu), <code>#stop</code> ve zprávě ji nastaví natrvalo, <code>#bot</code> ji zruší. Upozornění na leady
        chodí i během pauzy. Komentářů se pauza netýká.
      </p>

      <h2 className="mb-2 font-medium">S pauzou ({paused.length})</h2>
      <ContactTable rows={paused} now={now} empty="Žádný kontakt nemá pauzu – bot odpovídá všem." />

      <h2 className="mb-2 mt-8 font-medium">Ostatní – poslední aktivita</h2>
      <ContactTable rows={recent} now={now} empty="Zatím žádné kontakty." />
    </>
  );
}

function ContactTable({ rows, now, empty }: { rows: Row[]; now: Date; empty: string }) {
  return (
    <div className="card overflow-x-auto p-0">
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-neutral-500">{empty}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Kontakt</th>
              <th>Účet</th>
              <th>Poslední DM</th>
              <th>Bot</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, username }) => {
              const paused = isBotPaused(c, now);
              return (
                <tr key={c.id}>
                  <td>
                    {c.username ? <span className="font-medium">@{c.username}</span> : null}
                    <div className="font-mono text-xs text-neutral-500">{c.igScopedId}</div>
                  </td>
                  <td>{username ? `@${username}` : "—"}</td>
                  <td>{formatDate(c.lastInteractionAt)}</td>
                  <td>
                    {!paused ? (
                      <span className="text-green-700">odpovídá</span>
                    ) : c.botPausedPermanent ? (
                      <span className="font-medium text-red-600">pauza natrvalo</span>
                    ) : (
                      <span className="text-amber-700">pauza do {formatDate(c.botPausedUntil)}</span>
                    )}
                  </td>
                  <td className="text-right">
                    <form action={setContactBotAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="enable" value={String(paused)} />
                      <button className={paused ? "btn whitespace-nowrap" : "btn-secondary whitespace-nowrap"}>
                        {paused ? "Zapnout bota" : "Vypnout bota"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
