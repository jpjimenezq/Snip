"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "./ConfirmDialog";
import { Notice } from "./ui";
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
const STATUS_DOT: Record<AccountStatus, string> = {
  connected: "bg-ok",
  expired: "bg-warn",
  error: "bg-danger",
};

export function AccountStatusChip({ status }: { status: AccountStatus }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-zinc-300">
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Avatar({ account }: { account: SocialAccount }) {
  if (account.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={account.avatar_url} alt="" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-full bg-raised object-cover" />;
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-sm font-medium">
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

  const [pending, setPending] = useState<SocialAccount | null>(null);

  function disconnect(a: SocialAccount) {
    setPending(a);
  }

  async function confirmDisconnect() {
    const a = pending;
    if (!a) return;
    setBusy(a.id);
    const { error: err } = await createClient().from("social_accounts").delete().eq("id", a.id);
    setBusy(null);
    setPending(null);
    if (err) setMsg(`No se pudo desconectar: ${err.message}`);
    else setAccounts((prev) => prev.filter((x) => x.id !== a.id));
  }

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={!!pending}
        title="¿Desconectar esta cuenta?"
        confirmLabel="Desconectar"
        busy={!!busy}
        onConfirm={confirmDisconnect}
        onCancel={() => setPending(null)}
      >
        {pending && (
          <p>
            Se desconecta <strong>{pending.name}</strong> ({PLATFORM_LABEL[pending.platform]}) y se borran sus permisos
            guardados. Para volver a publicar ahí tendrás que conectarla de nuevo.
          </p>
        )}
      </ConfirmDialog>
      {connected && (
        <Notice tone="ok">
          {PLATFORM_LABEL[connected as SocialPlatform] ?? connected} conectado
          {count && count > 1 ? ` (${count} cuentas)` : ""}.
        </Notice>
      )}
      {(error || msg) && <Notice tone="error">{error ?? msg}</Notice>}

      <div className="grid gap-4 md:grid-cols-2">
        {SOCIAL_PLATFORMS.map((p) => {
          const mine = accounts.filter((a) => a.platform === p.id);
          const ok = configured ? configured[p.id] : true;
          const metaNote = p.id === "instagram" || p.id === "facebook";
          const nConnected = mine.filter((a) => a.status === "connected").length;
          return (
            <section key={p.id} className="panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ background: `var(--color-${p.id}, var(--color-muted))` }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <h2 className="text-[0.95rem] font-semibold">{p.label}</h2>
                    <p className="text-xs text-muted">{p.hint}</p>
                    <p className="timecode mt-1 text-xs text-faint">
                      {mine.length === 0
                        ? "Sin conectar"
                        : `${nConnected} de ${mine.length} ${mine.length === 1 ? "cuenta activa" : "cuentas activas"}`}
                    </p>
                  </div>
                </div>
                {ok ? (
                  <a
                    href={`/api/oauth/${p.id}/start`}
                    className={`btn btn-sm shrink-0 ${mine.length ? "btn-secondary" : "btn-primary"}`}
                  >
                    {mine.length ? "Reconectar / añadir" : "Conectar"}
                  </a>
                ) : (
                  <span className="btn btn-sm btn-secondary shrink-0 opacity-50">No configurado</span>
                )}
              </div>
              {!ok && (
                <div className="mt-3">
                  <Notice tone="info">
                    Faltan las credenciales de la app en el servidor. Sigue la sección de {p.label} en{" "}
                    <code className="rounded bg-bg px-1">docs/PUBLISHING.md</code>.
                  </Notice>
                </div>
              )}
              {ok && metaNote && (
                <p className="mt-2 text-xs text-faint">
                  Facebook e Instagram se conectan juntos con un solo inicio de sesión de Meta.
                </p>
              )}
              <ul className="mt-3 space-y-2">
                {loading && <li className="text-xs text-muted">Cargando…</li>}
                {!loading && mine.length === 0 && <li className="text-xs text-muted">Sin cuentas conectadas.</li>}
                {mine.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised p-2">
                    <Avatar account={a} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{a.name}</div>
                      {a.error && a.status !== "connected" && (
                        <div className="truncate text-xs text-danger" title={a.error}>
                          {a.error}
                        </div>
                      )}
                    </div>
                    <AccountStatusChip status={a.status} />
                    <button
                      type="button"
                      disabled={busy === a.id}
                      onClick={() => disconnect(a)}
                      className="btn btn-ghost btn-sm min-h-10 hover:text-danger"
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
