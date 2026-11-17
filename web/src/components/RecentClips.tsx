"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Clip } from "@/lib/types";
import { formatDuration } from "@/lib/time";
import { useSignedUrl } from "@/lib/useSignedUrl";
import { ScoreBadge, StatusChip } from "./Badges";

function MiniClip({ clip }: { clip: Clip }) {
  const frameUrl = useSignedUrl(clip.frame_path);
  return (
    <Link
      href={`/clips/${clip.id}`}
      className="block w-44 shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-surface transition hover:border-accent/60 sm:w-52"
    >
      <div className="relative aspect-video bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {frameUrl && <img src={frameUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute left-1.5 top-1.5">
          <ScoreBadge score={clip.score} />
        </div>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px]">
          {formatDuration(clip.end_s - clip.start_s)}
        </span>
      </div>
      <div className="space-y-1.5 p-2.5">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{clip.title || "Clip sin título"}</p>
        <StatusChip status={clip.status} kind="clip" />
      </div>
    </Link>
  );
}

/** Franja con los 6 clips más recientes. No muestra nada si aún no hay clips. */
export function RecentClips() {
  const [clips, setClips] = useState<Clip[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("clips")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(6);
    setClips((data as Clip[] | null) ?? []);
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
      .channel("recent-clips")
      .on("postgres_changes", { event: "*", schema: "public", table: "clips" }, schedule)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [load]);

  if (clips.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Últimos clips</h2>
        <Link href="/library" className="flex h-10 items-center text-sm text-accent hover:underline">
          Ver biblioteca →
        </Link>
      </div>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {clips.map((c) => (
          <MiniClip key={c.id} clip={c} />
        ))}
      </div>
    </section>
  );
}
