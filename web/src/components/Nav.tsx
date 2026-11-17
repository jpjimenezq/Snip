"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IS_DEMO, createClient } from "@/lib/supabase/client";
import { LogoMark, RecDot, Wordmark } from "./ui";

const LINKS = [
  { href: "/", label: "Inicio" },
  { href: "/library", label: "Biblioteca" },
  { href: "/live", label: "En vivo", live: true },
  { href: "/settings", label: "Cuentas" },
];

export function Nav() {
  const router = useRouter();
  const pathname = usePathname();
  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  const active = (href: string) =>
    href === "/"
      ? pathname === "/" || pathname.startsWith("/sources") || pathname.startsWith("/clips")
      : pathname.startsWith(href);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6">
        <Link href="/" className="flex h-10 shrink-0 items-center gap-2" aria-label="Snip, inicio">
          <LogoMark />
          <span className="hidden sm:inline">
            <Wordmark />
          </span>
          {IS_DEMO && (
            <span className="rounded border border-line-strong px-1.5 text-[10px] font-medium uppercase text-muted">
              Demo
            </span>
          )}
        </Link>
        <nav aria-label="Principal" className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {LINKS.map((l) => {
            const on = active(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on ? "page" : undefined}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors ${
                  on ? "bg-raised font-medium text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {l.live && <RecDot className="h-1.5 w-1.5" />}
                {l.label}
              </Link>
            );
          })}
        </nav>
        <button onClick={logout} hidden={IS_DEMO} className="btn btn-ghost btn-sm shrink-0">
          Salir
        </button>
      </div>
    </header>
  );
}
