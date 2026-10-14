import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts, rules } from "@/lib/db/schema";
import { deleteRuleAction } from "../../../actions";
import { ConfirmButton } from "../../confirm-button";
import { PageHeader } from "../../ui";
import { RuleForm } from "../rule-form";

export default async function EditRulePage({ params }: PageProps<"/admin/rules/[id]">) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const [[rule], accs] = await Promise.all([
    db.select().from(rules).where(eq(rules.id, id)).limit(1),
    db.select({ id: accounts.id, username: accounts.username }).from(accounts).orderBy(asc(accounts.username)),
  ]);
  if (!rule) notFound();

  return (
    <>
      <PageHeader title={rule.name || `Pravidlo #${rule.id}`}>
        <form action={deleteRuleAction}>
          <input type="hidden" name="id" value={rule.id} />
          <ConfirmButton message="Opravdu smazat toto pravidlo?">Smazat</ConfirmButton>
        </form>
      </PageHeader>
      <RuleForm rule={rule} accounts={accs} />
    </>
  );
}
