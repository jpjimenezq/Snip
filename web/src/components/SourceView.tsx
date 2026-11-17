"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Clip, Source } from "@/lib/types";
import { formatDuration, formatTime } from "@/lib/time";
import { youtubeId } from "@/lib/url";
import { PlatformBadge, ProgressBar, StatusChip } from "./Badges";
import { ClipCard } from "./ClipCard";
import { ManualClipPanel } from "./ManualClipPanel";
import { YouTubePlayer, type PlayerHandle } from "./YouTubePlayer";

function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.start_s - b.start_s);
}

export function SourceView({ id }: { id: string }) {
  const [source, setSource] = useState<Source | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = useRef<PlayerHandle>(null);

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

  if (!loaded) return <p className="text-sm text-zinc-500">Cargando...</p>;
  if (!source)
    return (
      <p className="text-sm text-zinc-400">
        {error ?? "Fuente no encontrada."}{" "}
        <Link href="/" className="text-accent underline">
          Volver
        </Link>
      </p>
    );

  const yt = source.platform === "youtube" ? youtubeId(source.url) : null;
  const working = !["ready", "error"].includes(source.status);
  const sorted = sortClips(clips);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Fuentes
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PlatformBadge platform={source.platform} />
          <StatusChip status={source.status} kind="source" />
          {source.duration_s != null && <span className="text-xs text-zinc-500">{formatTime(source.duration_s)}</span>}
        </div>
        <h1 className="mt-2 text-xl font-bold leading-snug">{source.title || source.url}</h1>
        {source.channel && <p className="text-sm text-zinc-400">{source.channel}</p>}
        <a href={source.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-zinc-500 hover:text-zinc-300">
          {source.url}
        </a>
        {working && (
          <div className="mt-3 max-w-md">
            <ProgressBar value={source.progress} />
          </div>
        )}
        {source.error && <p className="mt-2 text-sm text-red-400">{source.error}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {yt ? (
            <YouTubePlayer ref={player} videoId={yt} />
          ) : (
            <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-zinc-500">
              El reproductor solo está disponible para YouTube. Usa la vista previa de cada clip.
            </p>
          )}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Clips ({sorted.length})
            </h2>
            {sorted.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
                {working ? "Procesando... los clips sugeridos aparecerán aquí." : "Todavía no hay clips."}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {sorted.map((c) => (
                  <ClipCard key={c.id} clip={c} onSeek={yt ? (s) => player.current?.seekTo(s) : undefined} />
                ))}
              </div>
            )}
          </section>
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <ManualClipPanel sourceId={source.id} />
          {source.duration_s != null && (
            <p className="mt-2 text-xs text-zinc-500">Duración de la fuente: {formatDuration(source.duration_s)}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
