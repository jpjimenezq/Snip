"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteClip } from "@/lib/actions";
import type { Clip } from "@/lib/types";
import { formatDuration, formatTime } from "@/lib/time";
import { useSignedUrl } from "@/lib/useSignedUrl";
import { OriginBadge, ProgressBar, ScoreBadge, StatusChip, originLabel } from "./Badges";
import { Stat } from "./ui";
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
    <article className="group panel flex flex-col overflow-hidden transition-colors hover:border-line-strong">
      <div
        className="relative aspect-video cursor-pointer bg-raised"
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
          <div className="absolute inset-0 flex items-center justify-center text-xs text-faint">Sin imagen</div>
        )}
        <div className="absolute inset-x-2.5 top-2.5 flex items-start justify-between gap-2">
          <ScoreBadge score={clip.score} />
          <div className="flex gap-1.5">
            <OriginBadge origin={clip.origin} />
            {published && (
              <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-ok backdrop-blur">
                Publicado
              </span>
            )}
          </div>
        </div>
        <span className="timecode absolute bottom-2.5 right-2.5 rounded-md bg-black/75 px-1.5 py-0.5 text-xs text-zinc-100">
          {formatDuration(clip.end_s - clip.start_s)}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        <Link href={`/clips/${clip.id}`} className="line-clamp-2 text-sm font-medium leading-5 hover:text-white">
          {clip.title || "Clip sin título"}
        </Link>
        {sourceTitle && <p className="mt-0.5 truncate text-xs text-faint">{sourceTitle}</p>}
        {clip.hook && <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-muted">{clip.hook}</p>}
        {clip.reason && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-4 text-faint" title={clip.reason}>
            {clip.reason}
          </p>
        )}
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
          <Stat label="Momento" value={`${formatTime(clip.start_s)}`} />
          <Stat label="Origen" value={originLabel(clip.origin)} />
          <Stat label="Estado" value={<StatusChip status={clip.status} kind="clip" />} />
        </dl>
        {busy && (
          <div className="mt-3">
            <ProgressBar value={clip.progress} />
          </div>
        )}
        {clip.error && <p className="mt-2 line-clamp-2 text-xs text-danger">{clip.error}</p>}
        <div className="mt-auto flex gap-2 pt-3">
          <Link href={`/clips/${clip.id}`} className="btn btn-secondary btn-sm flex-1">
            Editar
          </Link>
          {onDeleted && (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              aria-label={`Eliminar clip ${clip.title ?? ""}`.trim()}
              className="btn btn-ghost btn-sm w-9 px-0 hover:text-danger"
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
