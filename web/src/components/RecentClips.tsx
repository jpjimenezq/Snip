"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Clip } from "@/lib/types";
import { formatDuration } from "@/lib/time";
import { useSignedUrl } from "@/lib/useSignedUrl";
import { ScoreBadge, StatusChip } from "./Badges";
import { LinkArrow, SectionHeader } from "./ui";

function MiniClip({ clip }: { clip: Clip }) {
  const frameUrl = useSignedUrl(clip.frame_path);
  return (
    <Link href={`/clips/${clip.id}`} className="group block w-36 shrink-0 snap-start sm:w-44">
      <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-line bg-raised transition-colors group-hover:border-line-strong">
        {frameUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frameUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
        <div className="absolute left-2 top-2">
          <ScoreBadge score={clip.score} />
        </div>
        <span className="timecode absolute right-2 top-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] text-zinc-100">
          {formatDuration(clip.end_s - clip.start_s)}
        </span>
        <div className="absolute inset-x-2.5 bottom-2.5">
          <p className="line-clamp-3 text-[13px] font-medium leading-snug text-white">
            {clip.title || "Clip sin título"}
          </p>
          <div className="mt-1.5">
            <StatusChip status={clip.status} kind="clip" />
          </div>
        </div>
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
      <SectionHeader title="Clips recientes" action={<LinkArrow href="/library">Ver biblioteca</LinkArrow>} />
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {clips.map((c) => (
          <MiniClip key={c.id} clip={c} />
        ))}
      </div>
    </section>
  );
}
