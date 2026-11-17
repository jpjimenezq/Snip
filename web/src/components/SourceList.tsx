"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteSource } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";
import type { SourceWithCount } from "@/lib/types";
import { formatRelative } from "@/lib/time";
import { PlatformBadge, ProgressBar, StatusChip } from "./Badges";
import { ConfirmDialog, TrashIcon } from "./ConfirmDialog";

export function SourceList() {
  const [sources, setSources] = useState<SourceWithCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toDelete, setToDelete] = useState<SourceWithCount | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function doDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDelError(null);
    try {
      await deleteSource(toDelete.id);
      setSources((cur) => cur?.filter((x) => x.id !== toDelete.id) ?? cur);
      setToDelete(null);
    } catch (e) {
      setDelError(e instanceof Error ? e.message : "No se pudo eliminar la fuente.");
    } finally {
      setDeleting(false);
    }
  }

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("sources")
      .select("*, clips(count)")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else {
      setError(null);
      setSources(data as SourceWithCount[]);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 400);
    };
    const channel = supabase
      .channel("dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "sources" }, schedule)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "clips" }, schedule)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "clips" }, schedule)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [load]);

  if (error) return <p className="text-sm text-red-400">No se pudieron cargar las fuentes: {error}</p>;
  if (!sources) return <p className="text-sm text-zinc-500">Cargando...</p>;
  if (sources.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-zinc-400">
        <p className="mb-3 font-medium text-zinc-200">Aún no hay fuentes. Así empiezas:</p>
        <ol className="list-inside list-decimal space-y-2 text-sm">
          <li>Pega un enlace de YouTube, Kick o Twitch arriba y la IA sugerirá los mejores momentos.</li>
          <li>
            Usa el atajo <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-zinc-200">Alt+Shift+S</kbd> con la
            extensión de Chrome mientras ves un video para clipear al instante.
          </li>
          <li>
            Agrega un canal en vivo en{" "}
            <Link href="/live" className="text-accent underline">
              En vivo
            </Link>{" "}
            para que Snip grabe un búfer y puedas clipear lo que acaba de pasar.
          </li>
        </ol>
      </div>
    );

  return (
    <>
    <ul className="space-y-3">
      {sources.map((s) => {
        const count = s.clips?.[0]?.count ?? 0;
        const working = !["ready", "error"].includes(s.status);
        return (
          <li key={s.id} className="flex items-stretch gap-2">
            <Link
              href={`/sources/${s.id}`}
              className="block min-w-0 flex-1 rounded-xl border border-white/10 bg-surface p-4 transition hover:border-accent/60"
            >
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={s.platform} />
                <StatusChip status={s.status} kind="source" />
                <span className="ml-auto text-xs text-zinc-500">
                  {count} {count === 1 ? "clip" : "clips"} · {formatRelative(s.created_at)}
                </span>
              </div>
              <p className="mt-2 truncate font-medium">{s.title || s.url}</p>
              {s.title && <p className="truncate text-xs text-zinc-500">{s.url}</p>}
              {working && (
                <div className="mt-3">
                  <ProgressBar value={s.progress} />
                </div>
              )}
              {s.error && <p className="mt-2 line-clamp-2 text-sm text-red-400">{s.error}</p>}
            </Link>
            <button
              type="button"
              onClick={() => setToDelete(s)}
              aria-label={`Eliminar fuente ${s.title || s.url}`}
              className="flex w-11 shrink-0 items-center justify-center self-stretch rounded-xl border border-white/10 bg-surface text-zinc-500 hover:border-red-500/50 hover:text-red-300"
            >
              <TrashIcon />
            </button>
          </li>
        );
      })}
    </ul>
    <ConfirmDialog
      open={!!toDelete}
      title="¿Eliminar esta fuente?"
      busy={deleting}
      error={delError}
      onConfirm={doDelete}
      onCancel={() => {
        setToDelete(null);
        setDelError(null);
      }}
    >
      {toDelete && (
        <>
          <p>
            Se eliminará <strong>{toDelete.title || toDelete.url}</strong> junto con sus{" "}
            <strong>
              {toDelete.clips?.[0]?.count ?? 0} {(toDelete.clips?.[0]?.count ?? 0) === 1 ? "clip" : "clips"}
            </strong>
            , la transcripción y las publicaciones registradas. Los videos ya publicados en tus redes no se borran.
          </p>
          <p>Esta acción no se puede deshacer.</p>
        </>
      )}
    </ConfirmDialog>
    </>
  );
}
