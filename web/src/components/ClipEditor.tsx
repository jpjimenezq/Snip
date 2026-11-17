"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createJob, deleteClip } from "@/lib/actions";
import { normalizeLayout, toContract } from "@/lib/layout";
import { createClient } from "@/lib/supabase/client";
import { formatDuration, formatTime } from "@/lib/time";
import type { Clip, Copies, Layout, SubtitleStyle, TranscriptSegment } from "@/lib/types";
import { getSignedUrl, useSignedUrl } from "@/lib/useSignedUrl";
import { ProgressBar, StatusChip, originLabel, scoreColor } from "./Badges";
import { Stat } from "./ui";
import { ConfirmDialog, TrashIcon } from "./ConfirmDialog";
import { CopiesEditor } from "./CopiesEditor";
import { PublishPanel } from "./PublishPanel";
import { LayoutEditor } from "./LayoutEditor";
import { ZoomEditor, ZoomTimeline } from "./ZoomEditor";

const SUBTITLES: { id: SubtitleStyle; label: string }[] = [
  { id: "karaoke", label: "Karaoke" },
  { id: "simple", label: "Simple" },
  { id: "none", label: "Sin subtítulos" },
];

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function NumberStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const step = (d: number) => onChange(Math.max(0, Math.round((value + d) * 100) / 100));
  return (
    <div>
      <label className="mb-1.5 block text-xs text-muted">{label}</label>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => step(-0.5)} aria-label={`${label} menos 0,5`} className="btn btn-secondary h-10 w-10 shrink-0 px-0">
          −
        </button>
        <input
          type="number"
          step={0.1}
          min={0}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="field timecode h-10 min-w-0 px-2 text-center"
        />
        <button type="button" onClick={() => step(0.5)} aria-label={`${label} más 0,5`} className="btn btn-secondary h-10 w-10 shrink-0 px-0">
          +
        </button>
      </div>
      <p className="timecode mt-1 text-center text-xs text-faint">{Number.isFinite(value) ? formatTime(value) : "—"}</p>
    </div>
  );
}

export function ClipEditor({ id }: { id: string }) {
  const [clip, setClip] = useState<Clip | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [layout, setLayout] = useState<Layout>(normalizeLayout(null));
  const [subtitle, setSubtitle] = useState<SubtitleStyle>("karaoke");
  const [copies, setCopies] = useState<Copies>({});
  const [copiesRev, setCopiesRev] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [finalDl, setFinalDl] = useState<string | null>(null);
  const copiesDirty = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const router = useRouter();
  // Rango que cubre preview.mp4 (el del clip al cargar la página).
  const [orig, setOrig] = useState<{ start: number; end: number } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("clips").select("*").eq("id", id).maybeSingle();
      if (cancelled) return;
      const c = data as Clip | null;
      if (c) {
        setClip(c);
        setStart(c.start_s);
        setEnd(c.end_s);
        setOrig({ start: c.start_s, end: c.end_s });
        setLayout(normalizeLayout(c.layout));
        setSubtitle(c.subtitle_style);
        setCopies(c.copies ?? {});
        const t = await supabase.from("transcripts").select("segments").eq("source_id", c.source_id).maybeSingle();
        if (!cancelled) setSegments(((t.data as { segments: TranscriptSegment[] } | null)?.segments) ?? []);
      }
      setLoaded(true);
    })();
    const channel = supabase
      .channel(`clip-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "clips", filter: `id=eq.${id}` }, (p) => {
        const row = p.new as Clip;
        setClip((prev) => (prev ? { ...prev, ...row } : row));
        if (!copiesDirty.current) {
          setCopies(row.copies ?? {});
          setCopiesRev((r) => r + 1);
        }
      })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [id]);

  const frameUrl = useSignedUrl(clip?.frame_path);
  const previewUrl = useSignedUrl(clip?.preview_path);
  const outputPath = clip?.status === "rendered" ? clip.output_path : null;
  const finalUrl = useSignedUrl(outputPath);
  useEffect(() => {
    if (!outputPath) return;
    let cancelled = false;
    getSignedUrl(outputPath, `snip-${id.slice(0, 8)}.mp4`).then((u) => !cancelled && setFinalDl(u));
    return () => {
      cancelled = true;
    };
  }, [outputPath, id]);

  const snippet = useMemo(
    () => segments.filter((s) => s.end > start && s.start < end),
    [segments, start, end],
  );

  // Vista previa recortada: solo se reproduce la parte de preview.mp4 que cae dentro de [start, end].
  const o = orig ?? { start, end };
  const ovStart = Math.max(start, o.start);
  const ovEnd = Math.min(end, o.end);
  const hasOverlap = Number.isFinite(ovStart) && Number.isFinite(ovEnd) && ovEnd - ovStart >= 0.2;
  // Ventana en tiempo del video de vista previa; sin solape se reproduce completo.
  const winStart = hasOverlap ? ovStart - o.start : 0;
  const winEnd = hasOverlap ? ovEnd - o.start : Math.max(0, o.end - o.start);
  const outside = Number.isFinite(start) && Number.isFinite(end) && (start < o.start - 0.05 || end > o.end + 0.05);
  const win = useRef({ s: 0, e: 0 });
  useEffect(() => {
    win.current = { s: winStart, e: winEnd };
  });

  // Al cambiar el inicio, coloca el video al comienzo del tramo recortado (si no se está reproduciendo).
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.paused && v.readyState > 0) v.currentTime = winStart;
  }, [winStart, previewUrl]);

  // Pausa/reinicia al llegar al final del tramo recortado (bucle).
  useEffect(() => {
    if (!previewUrl) return;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      const { s, e } = win.current;
      if (v.currentTime >= e - 0.03 || v.currentTime < s - 0.3) v.currentTime = s;
    }, 40);
    return () => clearInterval(t);
  }, [previewUrl]);

  if (!loaded) return <p className="text-sm text-muted">Cargando...</p>;
  if (!clip)
    return (
      <p className="text-sm text-muted">
        Clip no encontrado.{" "}
        <Link href="/" className="text-foreground underline">
          Volver
        </Link>
      </p>
    );

  const rendering = clip.status === "queued_render" || clip.status === "rendering";

  async function persist(): Promise<boolean> {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setMsg({ ok: false, text: "El fin debe ser mayor que el inicio." });
      return false;
    }
    const { error } = await createClient()
      .from("clips")
      .update({ start_s: start, end_s: end, layout: toContract(layout, end - start), subtitle_style: subtitle })
      .eq("id", id);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return false;
    }
    return true;
  }

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Error inesperado" });
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setDeleting(true);
    setDelError(null);
    try {
      await deleteClip(id);
      router.replace(`/sources/${clip!.source_id}`);
    } catch (e) {
      setDelError(e instanceof Error ? e.message : "No se pudo eliminar el clip.");
      setDeleting(false);
    }
  }

  const save = () => run(async () => ((await persist()) ? "Cambios guardados." : null));

  const render = () =>
    run(async () => {
      if (!(await persist())) return null;
      const { error } = await createClient()
        .from("clips")
        .update({ status: "queued_render", progress: 0, error: null })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await createJob("render_clip", { clip_id: id });
      setClip((c) => (c ? { ...c, status: "queued_render", progress: 0, error: null } : c));
      return "Render en cola.";
    });

  const genCopy = () =>
    run(async () => {
      await createJob("generate_copy", { clip_id: id });
      return "Generación de copies en cola. Se llenarán solos cuando el worker termine.";
    });

  const saveCopies = () =>
    run(async () => {
      const { error } = await createClient().from("clips").update({ copies }).eq("id", id);
      if (error) throw new Error(error.message);
      copiesDirty.current = false;
      return "Copies guardados.";
    });

  const dur = end - start;
  return (
    <div className="space-y-5">
      <header>
        <Link href={`/sources/${clip.source_id}`} className="inline-flex h-10 items-center text-sm text-muted hover:text-foreground">
          ← Fuente
        </Link>
        <h1 className="font-display mt-1 text-2xl">{clip.title || "Clip sin título"}</h1>
        {clip.hook && <p className="mt-1.5 max-w-3xl text-sm text-muted">{clip.hook}</p>}
        {clip.reason && <p className="mt-1 max-w-3xl text-xs text-faint">{clip.reason}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Puntaje viral"
            value={
              clip.score != null ? (
                <span className={`font-semibold ${scoreColor(clip.score)}`}>
                  {clip.score}
                  <span className="font-normal text-faint">/100</span>
                </span>
              ) : (
                "—"
              )
            }
          />
          <Stat label="Duración" value={Number.isFinite(dur) ? formatDuration(dur) : "—"} />
          <Stat label="Rango" value={`${formatTime(clip.start_s)} – ${formatTime(clip.end_s)}`} />
          <Stat label="Origen" value={originLabel(clip.origin)} />
          <Stat label="Estado" value={<StatusChip status={clip.status} kind="clip" />} />
        </dl>
        {rendering && (
          <div className="mt-3 max-w-md">
            <ProgressBar value={clip.progress} />
          </div>
        )}
        {clip.error && <p className="mt-2 text-sm text-danger">{clip.error}</p>}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Panel title="Vista previa">
            {previewUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={previewUrl}
                  controls
                  playsInline
                  onLoadedMetadata={(e) => {
                    e.currentTarget.currentTime = win.current.s;
                  }}
                  onPlay={(e) => {
                    const v = e.currentTarget;
                    const { s, e: en } = win.current;
                    if (v.currentTime < s - 0.05 || v.currentTime >= en - 0.05) v.currentTime = s;
                  }}
                  className="aspect-video w-full rounded-lg bg-black"
                />
                {outside && (
                  <p className="mt-2 rounded-lg border border-line bg-raised p-2 text-xs text-warn">
                    La vista previa no cubre el nuevo rango; el clip final sí lo tendrá.
                    {!hasOverlap && " Se muestra la vista previa original completa."}
                  </p>
                )}
                <ZoomTimeline
                  zooms={layout.zooms ?? []}
                  duration={end - start}
                  auto={layout.auto_zoom}
                  onSeek={(t) => {
                    const v = videoRef.current;
                    if (!v) return;
                    const { s, e } = win.current;
                    // t es relativo al NUEVO inicio; el video arranca en o.start.
                    v.currentTime = Math.min(Math.max(start + t - o.start, s), Math.max(s, e - 0.05));
                  }}
                />
              </>
            ) : (
              <p className="text-sm text-muted">Sin vista previa disponible.</p>
            )}
            {outputPath && (
              <div className="mt-4 border-t border-line pt-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Clip final <span className="timecode font-normal text-muted">1080x1920</span></h3>
                  {finalDl && (
                    <a href={finalDl} download className="btn btn-secondary btn-sm">
                      Descargar
                    </a>
                  )}
                </div>
                {finalUrl ? (
                  <video src={finalUrl} controls playsInline className="mx-auto max-h-[60vh] rounded-lg bg-black" />
                ) : (
                  <p className="text-sm text-muted">Cargando...</p>
                )}
              </div>
            )}
          </Panel>

          <Panel
            title="Recorte fino"
            action={
              <span className="timecode text-xs text-muted">
                Duración {Number.isFinite(dur) ? dur.toFixed(1) : "—"} s
              </span>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <NumberStepper label="Inicio (s)" value={start} onChange={setStart} />
              <NumberStepper label="Fin (s)" value={end} onChange={setEnd} />
            </div>
          </Panel>

          <Panel title="Transcripción del clip">
            {snippet.length === 0 ? (
              <p className="text-sm text-muted">Sin transcripción para este rango.</p>
            ) : (
              <div className="max-h-56 space-y-1.5 overflow-y-auto text-sm text-zinc-300">
                {snippet.map((s, i) => (
                  <p key={i}>
                    <span className="timecode mr-2 text-xs text-faint">{formatTime(s.start)}</span>
                    {s.text}
                  </p>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Encuadre vertical">
            <LayoutEditor frameUrl={frameUrl} layout={layout} onChange={setLayout} />
          </Panel>

          <Panel title="Zoom y seguimiento">
            <ZoomEditor
              layout={layout}
              onChange={setLayout}
              duration={end - start}
              getCurrentTime={() => {
                const v = videoRef.current;
                // Relativo al NUEVO inicio del clip.
                return v ? Math.max(0, v.currentTime + o.start - start) : null;
              }}
            />
          </Panel>

          <Panel title="Subtítulos">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Estilo de subtítulos">
              {SUBTITLES.map((s) => (
                <button key={s.id} type="button" onClick={() => setSubtitle(s.id)} aria-pressed={subtitle === s.id} className="chip min-h-10">
                  {s.label}
                </button>
              ))}
            </div>
          </Panel>

          <section className="panel space-y-3 p-4">
            <div className="flex flex-wrap gap-2">
              <button onClick={render} disabled={busy || rendering} className="btn btn-primary">
                {rendering ? "Renderizando..." : "Renderizar"}
              </button>
              <button onClick={save} disabled={busy} className="btn btn-secondary">
                Guardar cambios
              </button>
              <button onClick={genCopy} disabled={busy} className="btn btn-secondary">
                Generar copies
              </button>
              <button onClick={() => setConfirmDel(true)} disabled={busy} className="btn btn-danger ml-auto">
                <TrashIcon className="h-4 w-4" /> Eliminar clip
              </button>
            </div>
            {msg && <p className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
          </section>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
        <Panel
          title="Copies para redes"
          action={
            <button onClick={saveCopies} disabled={busy} className="btn btn-secondary btn-sm">
              Guardar copies
            </button>
          }
        >
          <CopiesEditor
            key={copiesRev}
            copies={copies}
            onChange={(c) => {
              copiesDirty.current = true;
              setCopies(c);
            }}
          />
        </Panel>

        <Panel title="Publicar en redes">
          <PublishPanel key={copiesRev} clip={{ ...clip, copies }} />
        </Panel>
      </div>
      <ConfirmDialog
        open={confirmDel}
        title="¿Eliminar este clip?"
        busy={deleting}
        error={delError}
        onConfirm={doDelete}
        onCancel={() => {
          setConfirmDel(false);
          setDelError(null);
        }}
      >
        <p>
          Se eliminará <strong>{clip.title || "este clip"}</strong> con su encuadre, copies, el video renderizado y las
          publicaciones registradas. Los videos ya publicados en tus redes no se borran.
        </p>
        <p>Esta acción no se puede deshacer.</p>
      </ConfirmDialog>
    </div>
  );
}
