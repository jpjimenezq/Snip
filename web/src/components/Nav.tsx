"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IS_DEMO, createClient } from "@/lib/supabase/client";

const LINKS = [
  { href: "/", label: "Clips" },
  { href: "/live", label: "En vivo" },
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
    <header className="sticky top-0 z-30 border-b border-white/10 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm text-white">✂</span>
          <span className="hidden sm:inline">Snip</span>
          {IS_DEMO && (
            <span className="rounded-md bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
              DEMO
            </span>
          )}
        </Link>
        <nav className="flex flex-1 items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-2.5 py-1.5 text-sm transition ${
                active(l.href) ? "bg-white/10 text-zinc-100" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={logout}
          hidden={IS_DEMO}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
        >
          Salir
        </button>
      </div>
    </header>
  );
}
