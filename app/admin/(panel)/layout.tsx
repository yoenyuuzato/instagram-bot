import Link from "next/link";
import { Suspense } from "react";
import { logoutAction } from "../actions";
import { ActiveNavLink, NavLink } from "./nav-link";

const nav = [
  { href: "/admin", label: "Přehled" },
  { href: "/admin/rules", label: "Pravidla" },
  { href: "/admin/accounts", label: "Účty" },
  { href: "/admin/contacts", label: "Kontakty" },
  { href: "/admin/events", label: "Log událostí" },
  { href: "/admin/simulate", label: "Simulátor" },
];

export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/admin" className="font-semibold">
            IG Bot
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            <Suspense fallback={nav.map((n) => <NavLink key={n.href} href={n.href} label={n.label} />)}>
              {nav.map((n) => (
                <ActiveNavLink key={n.href} href={n.href} label={n.label} />
              ))}
            </Suspense>
          </nav>
          {process.env.INSTAGRAM_MOCK !== "false" && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">MOCK režim</span>
          )}
          <form action={logoutAction}>
            <button className="text-sm text-neutral-500 hover:text-neutral-900">Odhlásit</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Suspense fallback={<p className="text-sm text-neutral-400">Načítám…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}
