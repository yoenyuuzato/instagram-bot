import { connection } from "next/server";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { DbError, PageHeader } from "../ui";
import { SimulateForm } from "./simulate-form";

export default async function SimulatePage() {
  await connection();
  let accs;
  try {
    accs = await getDb()
      .select({ id: accounts.id, username: accounts.username })
      .from(accounts)
      .orderBy(asc(accounts.username));
  } catch (e) {
    return (
      <>
        <PageHeader title="Simulátor" />
        <DbError error={e} />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Simulátor" />
      <p className="mb-6 max-w-2xl text-sm text-neutral-600">
        Vytvoří falešný webhook payload (komentář nebo DM), prožene ho rule enginem a ukáže, co by bot odeslal. Instagram API se
        nevolá (vždy mock), události se zapíšou do logu s označením <em>sim</em>. DM, které nesedí na pravidlo, u účtu se zapnutou AI
        odpoví Gemini.
      </p>
      <SimulateForm accounts={accs} />
    </>
  );
}
