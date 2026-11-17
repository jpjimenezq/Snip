"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { deleteSource, reanalyzeSource } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";
import type { Clip, Source } from "@/lib/types";
import { formatTime } from "@/lib/time";
import { youtubeId } from "@/lib/url";
import { PlatformBadge, ProgressBar, StatusChip } from "./Badges";
import { SectionHeader, Stat } from "./ui";
import { ClipCard } from "./ClipCard";
import { ConfirmDialog, TrashIcon } from "./ConfirmDialog";
import { ManualClipPanel } from "./ManualClipPanel";
import { YouTubePlayer, type PlayerHandle } from "./YouTubePlayer";

type SortKey = "score" | "time";

function sortClips(clips: Clip[], by: SortKey): Clip[] {
  return [...clips].sort((a, b) =>
    by === "time" ? a.start_s - b.start_s : (b.score ?? -1) - (a.score ?? -1) || a.start_s - b.start_s,
  );
}

const dateFmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" });

export function SourceView({ id }: { id: string }) {
  const [source, setSource] = useState<Source | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = useRef<PlayerHandle>(null);
  const router = useRouter();
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [reBusy, setReBusy] = useState(false);
  const [reMsg, setReMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("score");

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const [s, c] = await Promise.all([
        supabase.from("sources").select("*").eq("id", id).maybeSingle(),
        supabase.from("clips").select("*").eq("source_id", id),
      ]);
      if (cancelled) return;
      if (s.error) setError(s.error.message);
      setSource((s.data as Source | null) ?? null);
      setClips((c.data as Clip[] | null) ?? []);
      setLoaded(true);
    })();

    const channel = supabase
      .channel(`source-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sources", filter: `id=eq.${id}` }, (p) =>
        setSource(p.new as Source),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "clips", filter: `source_id=eq.${id}` }, (p) => {
        if (p.eventType === "DELETE") {
          const oldId = (p.old as { id?: string }).id;
          setClips((cs) => cs.filter((x) => x.id !== oldId));
        } else {
          const row = p.new as Clip;
          setClips((cs) => [...cs.filter((x) => x.id !== row.id), row]);
        }
      })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [id]);

  if (!loaded) return <p className="text-sm text-muted">Cargando...</p>;
  if (!source)
    return (
      <p className="text-sm text-muted">
        {error ?? "Fuente no encontrada."}{" "}
        <Link href="/" className="text-foreground underline">
          Volver
        </Link>
      </p>
    );

  const yt = source.platform === "youtube" ? youtubeId(source.url) : null;
  const working = !["ready", "error"].includes(source.status);
  const sorted = sortClips(clips, sortBy);

  async function doDelete() {
    setDeleting(true);
    setDelError(null);
    try {
      await deleteSource(id);
      router.replace("/");
    } catch (e) {
      setDelError(e instanceof Error ? e.message : "No se pudo eliminar la fuente.");
      setDeleting(false);
    }
  }

  async function reanalyze() {
    setReBusy(true);
    setReMsg(null);
    try {
      await reanalyzeSource(id);
      setSource((s) => (s ? { ...s, status: "analyzing", progress: 0, error: null } : s));
      setReMsg({
        ok: true,
        text: "Las sugerencias de la IA se reemplazan; tus clips manuales y renderizados se conservan.",
      });
    } catch (e) {
      setReMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo encolar el análisis." });
    } finally {
      setReBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <Link href="/" className="inline-flex h-10 items-center text-sm text-muted hover:text-foreground">
          ← Fuentes
        </Link>
        <h1 className="font-display mt-1 text-2xl">{source.title || source.url}</h1>
        {source.channel && <p className="mt-1.5 text-sm text-muted">{source.channel}</p>}
        <a href={source.url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs text-faint hover:text-foreground">
          {source.url}
        </a>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Plataforma" value={<PlatformBadge platform={source.platform} />} />
          <Stat label="Estado" value={<StatusChip status={source.status} kind="source" />} />
          <Stat label="Duración" value={source.duration_s != null ? formatTime(source.duration_s) : "—"} />
          <Stat label="Clips" value={clips.length} />
          <Stat label="Agregada" value={source.created_at ? dateFmt.format(new Date(source.created_at)) : "—"} />
        </dl>
        {working && (
          <div className="mt-3 max-w-md">
            <ProgressBar value={source.progress} />
          </div>
        )}
        {source.error && <p className="mt-2 text-sm text-danger">{source.error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {source.status === "ready" && (
            <button type="button" onClick={reanalyze} disabled={reBusy} className="btn btn-secondary">
              Volver a buscar momentos
            </button>
          )}
          <button type="button" onClick={() => setConfirmDel(true)} className="btn btn-danger">
            <TrashIcon className="h-4 w-4" /> Eliminar fuente
          </button>
        </div>
        {reMsg && <p className={`mt-2 text-sm ${reMsg.ok ? "text-ok" : "text-danger"}`}>{reMsg.text}</p>}
      </header>
      <ConfirmDialog
        open={confirmDel}
        title="¿Eliminar esta fuente?"
        busy={deleting}
        error={delError}
        onConfirm={doDelete}
        onCancel={() => {
          setConfirmDel(false);
          setDelError(null);
        }}
      >
        <p>
          Se eliminará <strong>{source.title || source.url}</strong> junto con sus{" "}
          <strong>
            {clips.length} {clips.length === 1 ? "clip" : "clips"}
          </strong>
          , la transcripción y las publicaciones registradas. Los videos ya publicados en tus redes no se borran.
        </p>
        <p>Esta acción no se puede deshacer.</p>
      </ConfirmDialog>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {yt ? (
            <YouTubePlayer ref={player} videoId={yt} />
          ) : (
            <p className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">
              El reproductor solo está disponible para YouTube. Usa la vista previa de cada clip.
            </p>
          )}
        </div>
        <aside className="lg:sticky lg:top-20">
          <ManualClipPanel sourceId={source.id} />
        </aside>
      </div>

      <section>
        <SectionHeader
          title="Clips"
          count={sorted.length}
          action={
            sorted.length > 1 ? (
              <div className="flex items-center gap-1.5" role="group" aria-label="Ordenar clips">
                <span className="text-xs text-faint">Ordenar</span>
                <button type="button" className="chip min-h-9" aria-pressed={sortBy === "score"} onClick={() => setSortBy("score")}>
                  Puntaje
                </button>
                <button type="button" className="chip min-h-9" aria-pressed={sortBy === "time"} onClick={() => setSortBy("time")}>
                  Tiempo
                </button>
              </div>
            ) : undefined
          }
        />
        {sorted.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">
            {working ? "Procesando... los clips sugeridos aparecerán aquí." : "Todavía no hay clips."}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sorted.map((c) => (
              <ClipCard
                key={c.id}
                clip={c}
                onSeek={yt ? (s) => player.current?.seekTo(s) : undefined}
                onDeleted={(cid) => setClips((cs) => cs.filter((x) => x.id !== cid))}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
