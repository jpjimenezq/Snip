import { DEFAULT_LAYOUT, type Layout, type LayoutPreset, type Region, type Zoom } from "./types";

export const OUT_W = 1080;
export const OUT_H = 1920;
export const MIN_H = 0.08;

export interface Size {
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Aspecto (ancho/alto) de cada zona de salida 1080x1920. */
export function zoneAspects(preset: LayoutPreset, splitRatio: number): number[] {
  if (preset === "fill") return [OUT_W / OUT_H];
  if (preset === "split") {
    return [OUT_W / (OUT_H * splitRatio), OUT_W / (OUT_H * (1 - splitRatio))];
  }
  return [];
}

/** Relación w/h normalizada que debe tener una región para que su aspecto en píxeles sea `zone`. */
export function normalizedRatio(zone: number, nat: Size): number {
  return (zone * nat.h) / nat.w;
}

/** Ajusta una región a la relación k (w = k*h) dentro de 0..1. */
export function fitRegion(r: Region, k: number): Region {
  const h = clamp(Math.min(r.h, 1 / k, 1), MIN_H, Math.min(1, 1 / k));
  const w = k * h;
  return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h), w, h };
}

export function centeredRegion(k: number, scale = 1): Region {
  const h = Math.min(1, 1 / k) * scale;
  const w = k * h;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export const ZOOM_MIN = 1.1;
export const ZOOM_MAX = 1.6;
export const ZOOM_DEFAULT = 1.3;
export const ZOOM_DEFAULT_LEN = 1.5;

/** Limpia zooms del layout: números válidos, dentro de la duración (si se conoce) y ordenados. */
export function sanitizeZooms(zooms: unknown, duration?: number): Zoom[] {
  if (!Array.isArray(zooms)) return [];
  const max = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const out: Zoom[] = [];
  for (const z of zooms as Partial<Zoom>[]) {
    const s = Number(z?.start);
    const e = Number(z?.end);
    const sc = Number(z?.scale);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    const start = clamp(s, 0, max);
    const end = clamp(e, 0, max);
    if (end <= start) continue;
    out.push({
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      scale: Math.round(clamp(Number.isFinite(sc) ? sc : ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX) * 100) / 100,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function normalizeLayout(layout: Layout | null): Layout {
  const l = layout ?? DEFAULT_LAYOUT;
  const preset = l.preset ?? "fill";
  const ratio = clamp(l.split_ratio ?? 0.5, 0.3, 0.7);
  const base: Layout = {
    preset,
    regions: l.regions ?? [],
    split_ratio: ratio,
    track_face: l.track_face === true,
    zooms: sanitizeZooms(l.zooms),
    auto_zoom: l.auto_zoom === true,
  };
  const need = zoneAspects(preset, ratio).length;
  if (base.regions.length < need) return changePreset(base, preset, { w: 16, h: 9 });
  return base;
}

/** Cambia de preset reutilizando regiones existentes cuando es posible. */
export function changePreset(layout: Layout, preset: LayoutPreset, nat: Size): Layout {
  const ratio = layout.split_ratio ?? 0.5;
  const zones = zoneAspects(preset, ratio);
  const ks = zones.map((z) => normalizedRatio(z, nat));
  const regions = ks.map((k, i) => {
    const existing = layout.regions[i];
    return existing ? fitRegion(existing, k) : centeredRegion(k, preset === "split" ? 0.8 : 1);
  });
  return { ...layout, preset, regions, split_ratio: ratio };
}

export function changeRatio(layout: Layout, ratio: number, nat: Size): Layout {
  const zones = zoneAspects("split", ratio);
  const regions = zones.map((z, i) => {
    const k = normalizedRatio(z, nat);
    return layout.regions[i] ? fitRegion(layout.regions[i], k) : centeredRegion(k, 0.8);
  });
  return { ...layout, regions, split_ratio: ratio };
}

/** Layout exacto según el contrato de docs/ARCHITECTURE.md. */
export function toContract(layout: Layout, duration?: number): Layout {
  const regions = layout.regions.map((r) => ({ x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) }));
  const extras: Partial<Layout> = {};
  if (layout.preset !== "fit_blur" && layout.track_face) extras.track_face = true;
  const zooms = sanitizeZooms(layout.zooms, duration);
  if (zooms.length) extras.zooms = zooms;
  if (layout.auto_zoom) extras.auto_zoom = true;
  if (layout.preset === "fit_blur") return { preset: "fit_blur", regions: [], ...extras };
  if (layout.preset === "split") {
    return { preset: "split", regions, split_ratio: round4(layout.split_ratio ?? 0.5), ...extras };
  }
  return { preset: "fill", regions: regions.slice(0, 1), ...extras };
}
