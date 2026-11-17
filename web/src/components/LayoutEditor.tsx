"use client";

import { useRef, useState } from "react";
import {
  changePreset,
  changeRatio,
  centeredRegion,
  MIN_H,
  normalizedRatio,
  zoneAspects,
  type Size,
} from "@/lib/layout";
import type { Layout, LayoutPreset, Region } from "@/lib/types";

const PRESETS: { id: LayoutPreset; label: string }[] = [
  { id: "fill", label: "Llenar" },
  { id: "fit_blur", label: "Ajustar con fondo" },
  { id: "split", label: "Dividir" },
];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Drag {
  idx: number;
  mode: "move" | "resize";
  sx: number;
  sy: number;
  orig: Region;
  k: number;
}

export function LayoutEditor({
  frameUrl,
  layout,
  onChange,
}: {
  frameUrl: string | null;
  layout: Layout;
  onChange: (l: Layout) => void;
}) {
  const [nat, setNat] = useState<Size>({ w: 1920, h: 1080 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const ratio = layout.split_ratio ?? 0.5;
  const zones = zoneAspects(layout.preset, ratio);
  const ks = zones.map((z) => normalizedRatio(z, nat));
  // Garantiza que existan las regiones necesarias para el preset actual.
  const regions: Region[] = zones.map((_, i) => layout.regions[i] ?? centeredRegion(ks[i], layout.preset === "split" ? 0.8 : 1));

  function update(idx: number, r: Region) {
    const next = regions.map((x, i) => (i === idx ? r : x));
    onChange({ ...layout, regions: next });
  }

  function down(e: React.PointerEvent, idx: number, mode: Drag["mode"]) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { idx, mode, sx: e.clientX, sy: e.clientY, orig: regions[idx], k: ks[idx] };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    const el = box.current;
    if (!d || !el) return;
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / rect.width;
    const dy = (e.clientY - d.sy) / rect.height;
    const o = d.orig;
    if (d.mode === "move") {
      update(d.idx, { ...o, x: clamp(o.x + dx, 0, 1 - o.w), y: clamp(o.y + dy, 0, 1 - o.h) });
    } else {
      const maxW = Math.min(1 - o.x, (1 - o.y) * d.k);
      const w = clamp(o.w + dx, MIN_H * d.k, maxW);
      update(d.idx, { ...o, w, h: w / d.k });
    }
  }

  function up() {
    drag.current = null;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preset de encuadre">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(changePreset({ ...layout, regions }, p.id, nat))}
            aria-pressed={layout.preset === p.id}
            className="chip min-h-10"
          >
            {p.label}
          </button>
        ))}
      </div>

      {layout.preset === "split" && (
        <label className="flex items-center gap-3 text-sm text-muted">
          Altura de arriba
          <input
            type="range"
            min={0.3}
            max={0.7}
            step={0.01}
            value={ratio}
            onChange={(e) => onChange(changeRatio({ ...layout, regions }, parseFloat(e.target.value), nat))}
            className="h-10 flex-1"
          />
          <span className="timecode w-10 text-right">{Math.round(ratio * 100)}%</span>
        </label>
      )}

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="min-w-0 flex-1">
          <div
            ref={box}
            className="relative w-full select-none overflow-hidden rounded-lg border border-line bg-black"
            style={{ aspectRatio: `${nat.w} / ${nat.h}` }}
          >
            {frameUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={frameUrl}
                alt="Frame del clip"
                draggable={false}
                className="absolute inset-0 h-full w-full"
                onLoad={(e) => {
                  const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                  if (w && h) setNat({ w, h });
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-faint">
                Sin frame disponible
              </div>
            )}
            {layout.preset !== "fit_blur" &&
              regions.map((r, i) => (
                <div
                  key={i}
                  onPointerDown={(e) => down(e, i, "move")}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  className="absolute cursor-move touch-none"
                  style={{
                    left: `${r.x * 100}%`,
                    top: `${r.y * 100}%`,
                    width: `${r.w * 100}%`,
                    height: `${r.h * 100}%`,
                    border: "1.5px solid rgba(255,255,255,0.9)",
                    background: "rgba(255,255,255,0.06)",
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                  }}
                >
                  {layout.preset === "split" && (
                    <span className="absolute left-1 top-1 rounded bg-black/75 px-1 text-[10px] font-medium text-foreground">
                      {i === 0 ? "Arriba" : "Abajo"}
                    </span>
                  )}
                  <div
                    onPointerDown={(e) => down(e, i, "resize")}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={up}
                    className="absolute bottom-0 right-0 flex h-11 w-11 cursor-nwse-resize touch-none items-end justify-end p-1"
                  >
                    <span className="h-4 w-4 rounded-[3px] border border-black/60 bg-white" />
                  </div>
                </div>
              ))}
          </div>
          <p className="mt-2 text-xs text-faint">
            {layout.preset === "fit_blur"
              ? "El video completo se centra con el mismo video desenfocado de fondo."
              : "Arrastra el recuadro para moverlo y usa el círculo de la esquina para cambiar su tamaño."}
          </p>
        </div>
        <MockPreview frameUrl={frameUrl} layout={layout} regions={regions} ratio={ratio} />
      </div>
    </div>
  );
}

function cropStyle(url: string, r: Region): React.CSSProperties {
  return {
    backgroundImage: `url("${url}")`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${100 / r.w}% ${100 / r.h}%`,
    backgroundPosition: `${r.w >= 0.9999 ? 0 : (r.x / (1 - r.w)) * 100}% ${r.h >= 0.9999 ? 0 : (r.y / (1 - r.h)) * 100}%`,
  };
}

function MockPreview({
  frameUrl,
  layout,
  regions,
  ratio,
}: {
  frameUrl: string | null;
  layout: Layout;
  regions: Region[];
  ratio: number;
}) {
  return (
    <div className="mx-auto w-36 shrink-0 sm:mx-0 sm:w-40">
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-line-strong bg-black">
        {frameUrl && layout.preset === "fill" && regions[0] && (
          <div className="absolute inset-0" style={cropStyle(frameUrl, regions[0])} />
        )}
        {frameUrl && layout.preset === "split" && regions.length === 2 && (
          <>
            <div className="absolute inset-x-0 top-0" style={{ height: `${ratio * 100}%`, ...cropStyle(frameUrl, regions[0]) }} />
            <div className="absolute inset-x-0 bottom-0" style={{ height: `${(1 - ratio) * 100}%`, ...cropStyle(frameUrl, regions[1]) }} />
            <div className="absolute inset-x-0 h-px bg-white/60" style={{ top: `${ratio * 100}%` }} />
          </>
        )}
        {frameUrl && layout.preset === "fit_blur" && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={frameUrl} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover blur-md" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={frameUrl} alt="" className="absolute inset-x-0 top-1/2 w-full -translate-y-1/2" />
          </>
        )}
      </div>
      <p className="mt-1 text-center text-xs text-faint">Resultado 9:16</p>
    </div>
  );
}
