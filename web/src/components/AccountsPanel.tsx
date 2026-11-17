"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  type AccountStatus,
  type SocialAccount,
  type SocialPlatform,
} from "@/lib/publish";

const STATUS_LABEL: Record<AccountStatus, string> = {
  connected: "Conectada",
  expired: "Expirada",
  error: "Error",
};
const STATUS_TONE: Record<AccountStatus, string> = {
  connected: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  expired: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  error: "bg-red-500/15 text-red-300 ring-red-500/30",
};

export function AccountStatusChip({ status }: { status: AccountStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Avatar({ account }: { account: SocialAccount }) {
  if (account.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={account.avatar_url} alt="" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-full bg-white/10 object-cover" />;
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-medium">
      {account.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AccountsPanel({ connected, error, count }: { connected?: string; error?: string; count?: number }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [configured, setConfigured] = useState<Record<SocialPlatform, boolean> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("social_accounts")
      .select("*")
      .order("created_at", { ascending: true });
    setAccounts((data as SocialAccount[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const supabase = createClient();
    const channel = supabase
      .channel("social-accounts")
      .on("postgres_changes", { event: "*", schema: "public", table: "social_accounts" }, () => load())
      .subscribe();
    fetch("/api/oauth/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setConfigured(j))
      .catch(() => setConfigured(null));
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function disconnect(a: SocialAccount) {
    if (!window.confirm(`¿Desconectar ${a.name} (${PLATFORM_LABEL[a.platform]})? Se borrarán sus tokens.`)) return;
    setBusy(a.id);
    const { error: err } = await createClient().from("social_accounts").delete().eq("id", a.id);
    setBusy(null);
    if (err) setMsg(`No se pudo desconectar: ${err.message}`);
    else setAccounts((prev) => prev.filter((x) => x.id !== a.id));
  }

  return (
    <div className="space-y-4">
      {connected && (
        <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 ring-1 ring-emerald-500/30">
          {PLATFORM_LABEL[connected as SocialPlatform] ?? connected} conectado
          {count && count > 1 ? ` (${count} cuentas)` : ""}.
        </div>
      )}
      {(error || msg) && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">{error ?? msg}</div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {SOCIAL_PLATFORMS.map((p) => {
          const mine = accounts.filter((a) => a.platform === p.id);
          const ok = configured ? configured[p.id] : true;
          const metaNote = p.id === "instagram" || p.id === "facebook";
          return (
            <section key={p.id} className="rounded-xl border border-white/10 bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">{p.label}</h2>
                  <p className="text-xs text-zinc-500">{p.hint}</p>
                </div>
                {ok ? (
                  <a
                    href={`/api/oauth/${p.id}/start`}
                    className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90"
                  >
                    {mine.length ? "Reconectar / añadir" : "Conectar"}
                  </a>
                ) : (
                  <span className="shrink-0 rounded-lg bg-white/5 px-3 py-1.5 text-sm text-zinc-400">No configurado</span>
                )}
              </div>
              {!ok && (
                <p className="mt-2 text-xs text-zinc-500">
                  Faltan las credenciales de la app en el servidor. Sigue la sección de {p.label} en{" "}
                  <code className="rounded bg-white/5 px-1">docs/PUBLISHING.md</code>.
                </p>
              )}
              {ok && metaNote && (
                <p className="mt-2 text-xs text-zinc-500">
                  Facebook e Instagram se conectan juntos con un solo inicio de sesión de Meta.
                </p>
              )}
              <ul className="mt-3 space-y-2">
                {loading && <li className="text-xs text-zinc-500">Cargando…</li>}
                {!loading && mine.length === 0 && <li className="text-xs text-zinc-500">Sin cuentas conectadas.</li>}
                {mine.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-lg bg-white/5 p-2">
                    <Avatar account={a} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{a.name}</div>
                      {a.error && a.status !== "connected" && <div className="truncate text-xs text-red-300" title={a.error}>{a.error}</div>}
                    </div>
                    <AccountStatusChip status={a.status} />
                    <button
                      type="button"
                      disabled={busy === a.id}
                      onClick={() => disconnect(a)}
                      className="rounded-md bg-white/5 px-2 py-1 text-xs text-zinc-300 hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50"
                    >
                      Desconectar
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
