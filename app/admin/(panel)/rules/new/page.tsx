import { connection } from "next/server";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { PageHeader } from "../../ui";
import { RuleForm } from "../rule-form";

export default async function NewRulePage({ searchParams }: PageProps<"/admin/rules/new">) {
  await connection();
  const preselected = Number((await searchParams).account) || undefined;
  const accs = await getDb().select({ id: accounts.id, username: accounts.username }).from(accounts).orderBy(asc(accounts.username));
  return (
    <>
      <PageHeader title="Nové pravidlo" />
      <RuleForm accounts={accs} defaultAccountId={accs.some((a) => a.id === preselected) ? preselected : undefined} />
    </>
  );
}
