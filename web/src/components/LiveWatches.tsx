"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  HEARTBEAT_STALE_S,
  addLiveWatch,
  deleteLiveWatch,
  formatAge,
  formatBuffer,
  heartbeatAgeS,
  setLiveEnabled,
  type LiveWatch,
} from "@/lib/live";
import { PlatformBadge } from "./Badges";
import { LiveClipRow } from "./LiveClipRow";

const STATUS: Record<string, { label: string; cls: string }> = {
  recording: { label: "Grabando", cls: "bg-red-500/15 text-red-300 ring-red-500/30" },
  offline: { label: "Fuera de línea", cls: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
  idle: { label: "Inactivo", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  error: { label: "Error", cls: "bg-red-500/15 text-red-300 ring-red-500/30" },
};

function LiveStatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.idle;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      {status === "recording" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {s.label}
    </span>
  );
}

export function LiveWatches() {
  const [watches, setWatches] = useState<LiveWatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("live_watches")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else {
      setError(null);
      setWatches(data as LiveWatch[]);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const channel = supabase
      .channel("live_watches")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_watches" }, () => load())
      .subscribe();
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await addLiveWatch(url);
      setUrl("");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<void>) {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            placeholder="Canal en vivo (kick.com/canal, twitch.tv/canal o directo de YouTube)"
            className="h-14 flex-1 rounded-xl border border-white/10 bg-surface px-4 text-base outline-none placeholder:text-zinc-500 focus:border-accent"
          />
          <button
            disabled={busy || !url.trim()}
            className="h-14 rounded-xl bg-accent px-6 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Agregando..." : "Grabar canal"}
          </button>
        </div>
        {formError && <p className="text-sm text-red-400">{formError}</p>}
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!watches && !error && <p className="text-sm text-zinc-500">Cargando...</p>}
      {watches && watches.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-zinc-500">
          Aún no grabas ningún canal. Agrega uno arriba y el worker guardará los últimos minutos en un búfer.
        </div>
      )}

      <ul className="space-y-3">
        {watches?.map((w) => {
          const age = heartbeatAgeS(w, now);
          const stale = w.enabled && (age === null || age > HEARTBEAT_STALE_S);
          return (
            <li key={w.id} className="space-y-3 rounded-xl border border-white/10 bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={w.platform} />
                <span className="font-semibold">{w.channel ?? w.url}</span>
                <LiveStatusChip status={w.enabled ? w.status : "idle"} />
                {!w.enabled && <span className="text-xs text-zinc-500">Pausado</span>}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => act(() => setLiveEnabled(w.id, !w.enabled))}
                    className="rounded-lg bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20"
                  >
                    {w.enabled ? "Pausar" : "Activar"}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`¿Dejar de grabar ${w.channel ?? w.url} y quitarlo de la lista?`))
                        act(() => deleteLiveWatch(w.id));
                    }}
                    className="rounded-lg bg-red-500/15 px-3 py-1.5 text-sm text-red-300 transition hover:bg-red-500/25"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400">
                <span>Últimos {formatBuffer(w.buffer_s)} guardados</span>
                {age !== null && <span>Latido {formatAge(age)}</span>}
              </div>
              {stale && (
                <p className="text-sm text-amber-300">
                  El worker no responde. Revisa que esté corriendo en tu PC (run.ps1).
                </p>
              )}
              {w.error && w.status === "error" && <p className="line-clamp-3 text-sm text-red-400">{w.error}</p>}
              {w.enabled && w.status === "recording" && <LiveClipRow url={w.url} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
