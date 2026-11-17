"use client";

import { sanitizeZooms, ZOOM_DEFAULT, ZOOM_DEFAULT_LEN, ZOOM_MAX, ZOOM_MIN } from "@/lib/layout";
import type { Layout, Zoom } from "@/lib/types";

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span>
        <span className="block text-sm text-foreground">{label}</span>
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
    </label>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="min-w-0 flex-1">
      <span className="mb-0.5 block text-[11px] text-faint">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(value - 0.5)} className="btn btn-secondary h-10 w-10 shrink-0 px-0">
          −
        </button>
        <input
          type="number"
          step={0.1}
          min={0}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="field timecode h-10 min-w-0 px-1 text-center text-sm"
        />
        <button type="button" onClick={() => onChange(value + 0.5)} className="btn btn-secondary h-10 w-10 shrink-0 px-0">
          +
        </button>
      </div>
    </div>
  );
}

/** Opciones de edición de la fase 2: seguir cara, zoom automático y zooms manuales. */
export function ZoomEditor({
  layout,
  onChange,
  duration,
  getCurrentTime,
}: {
  layout: Layout;
  onChange: (l: Layout) => void;
  /** Duración del clip en segundos (fin - inicio). */
  duration: number;
  /** Tiempo actual del video de vista previa (relativo al clip) o null si no está disponible. */
  getCurrentTime: () => number | null;
}) {
  const zooms = layout.zooms ?? [];
  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const canTrack = layout.preset === "fill" || layout.preset === "split";

  const setZooms = (z: Zoom[]) => onChange({ ...layout, zooms: z });
  const patch = (i: number, p: Partial<Zoom>) => setZooms(zooms.map((z, j) => (j === i ? { ...z, ...p } : z)));

  function setTime(i: number, key: "start" | "end", v: number) {
    if (!Number.isFinite(v)) return;
    const z = zooms[i];
    const t = round2(clamp(v, 0, dur || v));
    if (key === "start") patch(i, { start: Math.min(t, z.end - 0.1) });
    else patch(i, { end: Math.max(t, z.start + 0.1) });
  }

  function add() {
    const at = getCurrentTime();
    const start = round2(clamp(at ?? 0, 0, Math.max(0, dur - 0.5)));
    const end = round2(Math.min(dur || start + ZOOM_DEFAULT_LEN, start + ZOOM_DEFAULT_LEN));
    if (end <= start) return;
    setZooms(sanitizeZooms([...zooms, { start, end, scale: ZOOM_DEFAULT }], dur || undefined));
  }

  return (
    <div className="space-y-4">
      {canTrack && (
        <Toggle
          checked={layout.track_face === true}
          onChange={(v) => onChange({ ...layout, track_face: v })}
          label="Seguir la cara automáticamente"
          hint={
            layout.preset === "split"
              ? "Cada recuadro sigue la cara más grande dentro de él. Si no encuentra ninguna, usa el recuadro fijo."
              : "El recuadro sigue la cara más grande. Si no encuentra ninguna, usa el recuadro fijo."
          }
        />
      )}
      <Toggle
        checked={layout.auto_zoom === true}
        onChange={(v) => onChange({ ...layout, auto_zoom: v })}
        label="Zoom automático en momentos fuertes"
        hint="Acerca la imagen en los picos de volumen (como máximo uno cada ~7 s)."
      />

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Zooms manuales</h3>
          <button type="button" onClick={add} className="btn btn-secondary btn-sm min-h-10">
            Agregar zoom aquí
          </button>
        </div>
        {zooms.length === 0 ? (
          <p className="text-xs text-faint">
            Sin zooms. Reproduce la vista previa hasta el momento deseado y pulsa «Agregar zoom aquí».
          </p>
        ) : (
          <ul className="space-y-3">
            {zooms.map((z, i) => (
              <li key={i} className="rounded-lg border border-line bg-bg p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <TimeField label="Inicio (s)" value={z.start} onChange={(v) => setTime(i, "start", v)} />
                  <TimeField label="Fin (s)" value={z.end} onChange={(v) => setTime(i, "end", v)} />
                  <button
                    type="button"
                    onClick={() => setZooms(zooms.filter((_, j) => j !== i))}
                    aria-label="Eliminar zoom"
                    className="btn btn-danger btn-sm min-h-10"
                  >
                    Eliminar
                  </button>
                </div>
                <label className="mt-2 flex items-center gap-3 text-xs text-muted">
                  <span className="timecode w-20 shrink-0">Zoom ×{z.scale.toFixed(2)}</span>
                  <input
                    type="range"
                    min={ZOOM_MIN}
                    max={ZOOM_MAX}
                    step={0.05}
                    value={z.scale}
                    onChange={(e) => patch(i, { scale: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Barra fina bajo la vista previa que marca los zooms (manuales) dentro del clip. */
export function ZoomTimeline({
  zooms,
  duration,
  auto,
  onSeek,
}: {
  zooms: Zoom[];
  duration: number;
  auto?: boolean;
  onSeek?: (t: number) => void;
}) {
  if (!(duration > 0)) return null;
  return (
    <div className="mt-2">
      <div
        className="relative h-3 cursor-pointer rounded-full bg-line-strong"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSeek?.(clamp((e.clientX - r.left) / r.width, 0, 1) * duration);
        }}
        title="Zooms del clip"
      >
        {zooms.map((z, i) => (
          <div
            key={i}
            className="absolute top-0 h-full rounded-full bg-foreground/80"
            style={{
              left: `${(clamp(z.start, 0, duration) / duration) * 100}%`,
              width: `${(Math.max(0.05, clamp(z.end, 0, duration) - clamp(z.start, 0, duration)) / duration) * 100}%`,
            }}
            title={`Zoom ×${z.scale.toFixed(2)} · ${z.start.toFixed(1)}–${z.end.toFixed(1)} s`}
          />
        ))}
      </div>
      <p className="mt-1 text-[11px] text-faint">
        {zooms.length} zoom{zooms.length === 1 ? "" : "s"} manual{zooms.length === 1 ? "" : "es"}
        {auto ? " + automáticos en picos de audio" : ""}
      </p>
    </div>
  );
}
