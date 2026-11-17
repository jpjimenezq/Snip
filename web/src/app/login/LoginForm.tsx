"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LogoMark, Wordmark } from "@/components/ui";
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

  return (
    <form onSubmit={submit} className="panel w-full max-w-sm space-y-3 p-6">
      <div className="mb-6 text-center">
        <div className="mb-3 flex items-center justify-center gap-2.5">
          <LogoMark size={32} />
          <Wordmark />
        </div>
        <h1 className="sr-only">Snip</h1>
        <p className="text-sm text-muted">Inicia sesión para continuar</p>
      </div>
      <input type="email" required autoComplete="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} className="field" />
      <input type="password" required autoComplete="current-password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} className="field" />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        {busy ? "Entrando..." : "Entrar"}
      </button>
      <p className="text-center text-xs text-faint">
        Panel personal de un solo usuario: la cuenta se crea desde el panel de Supabase (Authentication → Users).
      </p>
    </form>
  );
}
