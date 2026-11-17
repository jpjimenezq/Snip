"use client";

import Link from "next/link";
import { useState } from "react";
import type { Clip } from "@/lib/types";
import { formatDuration, formatTime } from "@/lib/time";
import { useSignedUrl } from "@/lib/useSignedUrl";
import { OriginBadge, ProgressBar, ScoreBadge, StatusChip } from "./Badges";

export function ClipCard({ clip, onSeek }: { clip: Clip; onSeek?: (s: number) => void }) {
  const [active, setActive] = useState(false);
  const frameUrl = useSignedUrl(clip.frame_path);
  const previewUrl = useSignedUrl(clip.preview_path, active);
  const busy = clip.status === "queued_render" || clip.status === "rendering";

  function toggle() {
    setActive((a) => !a);
    onSeek?.(clip.start_s);
  }

  return (
    <article className="overflow-hidden rounded-xl border border-white/10 bg-surface">
      <div
        className="relative aspect-video cursor-pointer bg-black"
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onClick={toggle}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {frameUrl && <img src={frameUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        {active && previewUrl && (
          <video src={previewUrl} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
        )}
        {!frameUrl && !previewUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600">Sin imagen</div>
        )}
        <div className="absolute left-2 top-2 flex gap-1.5">
          <ScoreBadge score={clip.score} />
          <OriginBadge origin={clip.origin} />
        </div>
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs">
          {formatDuration(clip.end_s - clip.start_s)}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <Link href={`/clips/${clip.id}`} className="block font-medium leading-snug hover:text-accent">
          {clip.title || "Clip sin título"}
        </Link>
        {clip.hook && <p className="line-clamp-2 text-sm text-zinc-400">{clip.hook}</p>}
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <span>
            {formatTime(clip.start_s)}–{formatTime(clip.end_s)}
          </span>
          <StatusChip status={clip.status} kind="clip" />
        </div>
        {busy && <ProgressBar value={clip.progress} />}
        {clip.error && <p className="line-clamp-2 text-xs text-red-400">{clip.error}</p>}
        <Link
          href={`/clips/${clip.id}`}
          className="block rounded-lg bg-white/5 py-1.5 text-center text-sm text-zinc-200 hover:bg-white/10"
        >
          Editar
        </Link>
      </div>
    </article>
  );
}
