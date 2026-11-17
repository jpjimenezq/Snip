"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { IS_DEMO, createClient } from "@/lib/supabase/client";

export function Nav() {
  const router = useRouter();
  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm text-white">✂</span>
          Snip
          {IS_DEMO && (
            <span className="rounded-md bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
              DEMO
            </span>
          )}
        </Link>
        <button onClick={logout} hidden={IS_DEMO} className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
          Salir
        </button>
      </div>
    </header>
  );
}
