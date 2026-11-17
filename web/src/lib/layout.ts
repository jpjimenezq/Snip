import { DEFAULT_LAYOUT, type Layout, type LayoutPreset, type Region } from "./types";

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

export function normalizeLayout(layout: Layout | null): Layout {
  const l = layout ?? DEFAULT_LAYOUT;
  const preset = l.preset ?? "fill";
  const ratio = clamp(l.split_ratio ?? 0.5, 0.3, 0.7);
  const base: Layout = { preset, regions: l.regions ?? [], split_ratio: ratio };
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
  return { preset, regions, split_ratio: ratio };
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
export function toContract(layout: Layout): Layout {
  const regions = layout.regions.map((r) => ({ x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) }));
  if (layout.preset === "fit_blur") return { preset: "fit_blur", regions: [] };
  if (layout.preset === "split") {
    return { preset: "split", regions, split_ratio: round4(layout.split_ratio ?? 0.5) };
  }
  return { preset: "fill", regions: regions.slice(0, 1) };
}
