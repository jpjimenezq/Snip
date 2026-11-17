"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/url";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setError("Correo o contraseña incorrectos.");
      setBusy(false);
      return;
    }
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  const field =
    "h-12 w-full rounded-xl border border-white/10 bg-surface px-4 outline-none placeholder:text-zinc-500 focus:border-accent";

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-2xl text-white">✂</div>
        <h1 className="text-2xl font-bold">Snip</h1>
        <p className="text-sm text-zinc-500">Inicia sesión para continuar</p>
      </div>
      <input type="email" required autoComplete="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
      <input type="password" required autoComplete="current-password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button disabled={busy} className="h-12 w-full rounded-xl bg-accent font-semibold text-white hover:brightness-110 disabled:opacity-50">
        {busy ? "Entrando..." : "Entrar"}
      </button>
      <p className="text-center text-xs text-zinc-500">
        Panel personal de un solo usuario: la cuenta se crea desde el panel de Supabase (Authentication → Users).
      </p>
    </form>
  );
}
