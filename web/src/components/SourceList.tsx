"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteSource } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";
import type { SourceWithCount } from "@/lib/types";
import { formatRelative, formatTime } from "@/lib/time";
import { PlatformBadge, ProgressBar, StatusChip } from "./Badges";
import { EmptySteps, Stat } from "./ui";
import { useSignedUrl } from "@/lib/useSignedUrl";
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

  if (error) return <p className="text-sm text-danger">No se pudieron cargar las fuentes: {error}</p>;
  if (!sources) return <p className="text-sm text-muted">Cargando…</p>;
  if (sources.length === 0)
    return (
      <EmptySteps
        title="Aún no hay fuentes. Así empiezas:"
        steps={[
          <>
            <strong className="text-foreground">Pega un enlace</strong> de YouTube, Kick o Twitch arriba. La IA te
            sugiere los mejores momentos.
          </>,
          <>
            Instala la extensión y pulsa <span className="kbd">Alt</span> <span className="kbd">Shift</span>{" "}
            <span className="kbd">S</span> mientras ves un video para clipear al instante.
          </>,
          <>
            Agrega un canal en{" "}
            <Link href="/live" className="text-accent underline underline-offset-4">
              En vivo
            </Link>{" "}
            y Snip guarda los últimos minutos para que no se te escape nada.
          </>,
        ]}
      />
    );

  return (
    <>
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sources.map((s) => (
        <SourceCard key={s.id} source={s} onDelete={() => setToDelete(s)} />
      ))}
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

function SourceCard({ source: s, onDelete }: { source: SourceWithCount; onDelete: () => void }) {
  const thumb = useSignedUrl(s.thumb_path);
  const count = s.clips?.[0]?.count ?? 0;
  const working = !["ready", "error"].includes(s.status);
  return (
    <li className="group panel relative overflow-hidden transition-colors hover:border-line-strong">
      <Link href={`/sources/${s.id}`} className="block">
        <div className="relative aspect-video bg-raised">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-faint">Sin miniatura</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <div className="absolute left-2.5 top-2.5 rounded-md bg-black/70 px-2 py-1 backdrop-blur">
            <PlatformBadge platform={s.platform} />
          </div>
          {s.duration_s != null && (
            <span className="timecode absolute bottom-2.5 right-2.5 rounded-md bg-black/75 px-1.5 py-0.5 text-xs text-zinc-100">
              {formatTime(s.duration_s)}
            </span>
          )}
          {working && (
            <div className="absolute inset-x-2.5 bottom-2.5 right-16">
              <ProgressBar value={s.progress} />
            </div>
          )}
        </div>
        <div className="p-3.5">
          <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-5 group-hover:text-white">
            {s.title || s.url}
          </p>
          <p className="mt-0.5 truncate text-xs text-faint">{s.channel || s.url}</p>
          {s.error && <p className="mt-2 line-clamp-2 text-xs text-danger">{s.error}</p>}
          <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
            <Stat label="Estado" value={<StatusChip status={s.status} kind="source" />} />
            <Stat label="Clips" value={count} />
            <Stat label="Agregado" value={formatRelative(s.created_at)} />
          </dl>
        </div>
      </Link>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Eliminar fuente ${s.title || s.url}`}
        className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-lg bg-black/70 text-zinc-300 opacity-0 backdrop-blur transition hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
      >
        <TrashIcon />
      </button>
    </li>
  );
}
