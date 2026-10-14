"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = { href: string; label: string };

export function NavLink({ href, label, active = false }: Props & { active?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
    >
      {label}
    </Link>
  );
}

export function ActiveNavLink({ href, label }: Props) {
  const pathname = usePathname();
  const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
  return <NavLink href={href} label={label} active={active} />;
}
