import Link from "next/link";

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}

const statusColors: Record<string, string> = {
  sent: "bg-green-100 text-green-800",
  processed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  skipped: "bg-amber-100 text-amber-800",
  ignored: "bg-neutral-100 text-neutral-600",
  duplicate: "bg-neutral-100 text-neutral-600",
  pending: "bg-blue-100 text-blue-800",
  received: "bg-blue-100 text-blue-800",
};

const statusLabels: Record<string, string> = {
  sent: "odesláno",
  processed: "zpracováno",
  failed: "chyba",
  skipped: "přeskočeno",
  ignored: "ignorováno",
  duplicate: "duplikát",
  pending: "čeká",
  received: "přijato",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${statusColors[status] ?? "bg-neutral-100"}`}>
      {statusLabels[status] ?? status}
    </span>
  );
}

export const kindLabels: Record<string, string> = {
  comment: "Komentář",
  message: "DM",
  public_reply: "Veřejná odpověď",
  private_reply: "Private reply",
  dm: "DM odpověď",
  ai_reply: "AI odpověď",
  lead_notify: "Upozornění na lead",
  rule_notify: "Upozornění na pravidlo",
  token_refresh: "Obnova tokenu",
  token_alert: "Upozornění na token",
  human_reply: "Ruční odpověď",
};

export function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Prague" }).format(d);
}

export function DbError({ error }: { error: unknown }) {
  return (
    <div className="card border-red-200 bg-red-50 text-sm text-red-800">
      <p className="font-medium">Nepodařilo se načíst data z databáze.</p>
      <p className="mt-1 font-mono text-xs">{error instanceof Error ? error.message : String(error)}</p>
      <p className="mt-2">Zkontrolujte DATABASE_URL a spusťte migrace (<code>npm run db:migrate</code>).</p>
    </div>
  );
}

// Barva štítku účtu – podle ID, aby byla stejná na všech stránkách.
const accountColors = [
  "bg-sky-100 text-sky-800 border-sky-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-violet-100 text-violet-800 border-violet-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-teal-100 text-teal-800 border-teal-200",
  "bg-indigo-100 text-indigo-800 border-indigo-200",
  "bg-orange-100 text-orange-800 border-orange-200",
];

export function accountColor(id: number) {
  return accountColors[Math.abs(id) % accountColors.length];
}

export function AccountBadge({ id, username }: { id: number; username: string }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${accountColor(id)}`}>
      @{username}
    </span>
  );
}

export const pillClass = (active: boolean) =>
  `rounded-md px-2.5 py-1 text-sm ${active ? "bg-neutral-900 text-white" : "bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-100"}`;

/** Přepínač účtu (?account=ID). `counts` = počet položek u každého účtu. */
export function AccountSwitcher({
  accounts,
  current,
  counts,
  total,
  href,
}: {
  accounts: { id: number; username: string }[];
  current: number | null;
  counts?: Map<number, number>;
  /** Počet u „Všechny účty“; výchozí = součet `counts`. */
  total?: number;
  href: (account: string | null) => string;
}) {
  total ??= counts ? [...counts.values()].reduce((a, b) => a + b, 0) : undefined;
  const count = (n: number | null | undefined) => (n == null ? null : <span className="ml-1.5 text-xs opacity-60">{n}</span>);
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <Link href={href(null)} className={pillClass(!current)}>
        Všechny účty{count(total)}
      </Link>
      {accounts.map((a) => (
        <Link key={a.id} href={href(String(a.id))} className={`inline-flex items-center gap-1.5 ${pillClass(current === a.id)}`}>
          <span className={`inline-block h-2.5 w-2.5 rounded-full border ${accountColor(a.id)}`} />@{a.username}
          {counts && count(counts.get(a.id) ?? 0)}
        </Link>
      ))}
    </div>
  );
}

/** Sestaví URL stránky ze současných parametrů + změn (null/"" = odebrat). */
export function makeHref(path: string, current: Record<string, string | null>) {
  return (p: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...p })) if (v) q.set(k, v);
    const s = q.toString();
    return `${path}${s ? `?${s}` : ""}`;
  };
}
