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
