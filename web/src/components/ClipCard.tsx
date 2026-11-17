"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteClip } from "@/lib/actions";
import type { Clip } from "@/lib/types";
import { formatDuration, formatTime } from "@/lib/time";
import { useSignedUrl } from "@/lib/useSignedUrl";
import { OriginBadge, ProgressBar, ScoreBadge, StatusChip } from "./Badges";
import { ConfirmDialog, TrashIcon } from "./ConfirmDialog";

export function ClipCard({
  clip,
  onSeek,
  onDeleted,
  published,
  sourceTitle,
}: {
  clip: Clip;
  onSeek?: (s: number) => void;
  /** Si se pasa, la tarjeta muestra el botón de eliminar. */
  onDeleted?: (id: string) => void;
  published?: boolean;
  sourceTitle?: string | null;
}) {
  const [active, setActive] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const frameUrl = useSignedUrl(clip.frame_path);
  const previewUrl = useSignedUrl(clip.preview_path, active);
  const busy = clip.status === "queued_render" || clip.status === "rendering";

  function toggle() {
    setActive((a) => !a);
    onSeek?.(clip.start_s);
  }

  async function doDelete() {
    setDeleting(true);
    setDelError(null);
    try {
      await deleteClip(clip.id);
      setConfirm(false);
      onDeleted?.(clip.id);
    } catch (e) {
      setDelError(e instanceof Error ? e.message : "No se pudo eliminar el clip.");
    } finally {
      setDeleting(false);
    }
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
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <ScoreBadge score={clip.score} />
          <OriginBadge origin={clip.origin} />
          {published && (
            <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">Publicado</span>
          )}
        </div>
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs">
          {formatDuration(clip.end_s - clip.start_s)}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <Link href={`/clips/${clip.id}`} className="block py-1 font-medium leading-snug hover:text-accent">
          {clip.title || "Clip sin título"}
        </Link>
        {sourceTitle && <p className="truncate text-xs text-zinc-500">{sourceTitle}</p>}
        {clip.hook && <p className="line-clamp-2 text-sm text-zinc-400">{clip.hook}</p>}
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <span>
            {formatTime(clip.start_s)}–{formatTime(clip.end_s)}
          </span>
          <StatusChip status={clip.status} kind="clip" />
        </div>
        {busy && <ProgressBar value={clip.progress} />}
        {clip.error && <p className="line-clamp-2 text-xs text-red-400">{clip.error}</p>}
        <div className="flex gap-2">
          <Link
            href={`/clips/${clip.id}`}
            className="flex h-10 flex-1 items-center justify-center rounded-lg bg-white/5 text-sm text-zinc-200 hover:bg-white/10"
          >
            Editar
          </Link>
          {onDeleted && (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              aria-label={`Eliminar clip ${clip.title ?? ""}`.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-300 hover:bg-red-500/20"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        title="¿Eliminar este clip?"
        busy={deleting}
        error={delError}
        onConfirm={doDelete}
        onCancel={() => {
          setConfirm(false);
          setDelError(null);
        }}
      >
        <p>
          Se eliminará <strong>{clip.title || "este clip"}</strong> junto con su edición, sus copies y sus publicaciones
          registradas. Los videos ya publicados en tus redes no se borran.
        </p>
        <p>Esta acción no se puede deshacer.</p>
      </ConfirmDialog>
    </article>
  );
}
