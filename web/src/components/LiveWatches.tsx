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
import { Notice, RecDot, SectionHeader } from "./ui";

const STATUS: Record<string, { label: string; dot: string }> = {
  recording: { label: "Grabando", dot: "bg-live" },
  offline: { label: "Fuera de línea", dot: "bg-faint" },
  idle: { label: "Inactivo", dot: "bg-info" },
  error: { label: "Error", dot: "bg-danger" },
};

function LiveStatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.idle;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
      {status === "recording" ? <RecDot /> : <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />}
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
    <div className="space-y-5">
      <form onSubmit={add} className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            aria-label="Canal en vivo"
            placeholder="Canal en vivo (kick.com/canal, twitch.tv/canal o directo de YouTube)"
            className="field sm:flex-1"
          />
          <button disabled={busy || !url.trim()} className="btn btn-primary h-11">
            {busy ? "Agregando..." : "Grabar canal"}
          </button>
        </div>
        {formError && <Notice tone="error">{formError}</Notice>}
      </form>

      {error && <Notice tone="error">{error}</Notice>}
      {!watches && !error && <p className="text-sm text-muted">Cargando...</p>}
      {watches && watches.length === 0 && (
        <div className="panel p-8 text-center text-sm text-muted">
          Aún no grabas ningún canal. Agrega uno arriba y el worker guardará los últimos minutos en un búfer.
        </div>
      )}

      {watches && watches.length > 0 && <SectionHeader title="Canales" count={watches.length} />}
      <ul className="space-y-3">
        {watches?.map((w) => {
          const age = heartbeatAgeS(w, now);
          const stale = w.enabled && (age === null || age > HEARTBEAT_STALE_S);
          return (
            <li key={w.id} className="panel space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <PlatformBadge platform={w.platform} />
                <span className="min-w-0 truncate text-[0.95rem] font-semibold">{w.channel ?? w.url}</span>
                <LiveStatusChip status={w.enabled ? w.status : "idle"} />
                {!w.enabled && <span className="text-xs text-faint">Pausado</span>}
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => act(() => setLiveEnabled(w.id, !w.enabled))} className="btn btn-secondary btn-sm min-h-10">
                    {w.enabled ? "Pausar" : "Activar"}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`¿Dejar de grabar ${w.channel ?? w.url} y quitarlo de la lista?`))
                        act(() => deleteLiveWatch(w.id));
                    }}
                    className="btn btn-danger btn-sm min-h-10"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
              <dl className="flex flex-wrap gap-x-6 gap-y-1">
                <div>
                  <dt className="text-[11px] text-faint">Búfer</dt>
                  <dd className="timecode text-[13px] text-zinc-200">Últimos {formatBuffer(w.buffer_s)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-faint">Latido</dt>
                  <dd className="timecode text-[13px] text-zinc-200">{age !== null ? formatAge(age) : "sin datos"}</dd>
                </div>
              </dl>
              {stale && <Notice tone="warn">El worker no responde. Revisa que esté corriendo en tu PC (run.ps1).</Notice>}
              {w.error && w.status === "error" && <p className="line-clamp-3 text-sm text-danger">{w.error}</p>}
              {w.enabled && w.status === "recording" && <LiveClipRow url={w.url} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
