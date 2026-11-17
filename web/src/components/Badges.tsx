import type { ClipOrigin, ClipStatus, Platform, SourceStatus } from "@/lib/types";

const SOURCE_LABEL: Record<SourceStatus, string> = {
  queued: "En cola",
  downloading: "Descargando",
  transcribing: "Transcribiendo",
  analyzing: "Analizando",
  ready: "Listo",
  error: "Error",
};
const CLIP_LABEL: Record<ClipStatus, string> = {
  suggested: "Sugerido",
  queued_render: "En cola",
  rendering: "Renderizando",
  rendered: "Renderizado",
  error: "Error",
};

function dot(status: string): string {
  if (status === "ready" || status === "rendered") return "bg-ok";
  if (status === "error") return "bg-danger";
  if (status === "suggested") return "bg-info";
  if (status === "queued" || status === "queued_render") return "bg-faint";
  return "bg-warn";
}

export function isBusy(status: string): boolean {
  return ["downloading", "transcribing", "analyzing", "rendering", "queued", "queued_render"].includes(status);
}

export function StatusChip({ status, kind }: { status: SourceStatus | ClipStatus; kind: "source" | "clip" }) {
  const label = kind === "source" ? SOURCE_LABEL[status as SourceStatus] : CLIP_LABEL[status as ClipStatus];
  const working = ["downloading", "transcribing", "analyzing", "rendering"].includes(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
      <span className={`h-1.5 w-1.5 rounded-full ${dot(status)} ${working ? "animate-rec" : ""}`} />
      {label ?? status}
    </span>
  );
}

const PLATFORM: Record<Platform, { label: string; color: string }> = {
  youtube: { label: "YouTube", color: "var(--color-youtube)" },
  kick: { label: "Kick", color: "var(--color-kick)" },
  twitch: { label: "Twitch", color: "var(--color-twitch)" },
  other: { label: "Web", color: "var(--color-muted)" },
};

export function platformColor(platform: Platform): string {
  return (PLATFORM[platform] ?? PLATFORM.other).color;
}

export function PlatformBadge({ platform }: { platform: Platform }) {
  const p = PLATFORM[platform] ?? PLATFORM.other;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
      <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
      {p.label}
    </span>
  );
}

const ORIGIN: Record<ClipOrigin, string> = { ai: "IA", manual: "Manual", hotkey: "Atajo" };

export function originLabel(origin: ClipOrigin): string {
  return ORIGIN[origin] ?? origin;
}

export function OriginBadge({ origin }: { origin: ClipOrigin }) {
  return (
    <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-zinc-200 backdrop-blur">
      {originLabel(origin)}
    </span>
  );
}

export function scoreColor(score: number): string {
  if (score >= 80) return "text-ok";
  if (score >= 60) return "text-warn";
  return "text-muted";
}

/** Puntaje viral sobre la miniatura: número grande con color según qué tan bueno es. */
export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  return (
    <span className="inline-flex items-baseline gap-0.5 rounded-md bg-black/75 px-1.5 py-0.5 backdrop-blur">
      <span className={`timecode text-sm font-semibold ${scoreColor(score)}`}>{score}</span>
      <span className="text-[10px] text-zinc-400">/100</span>
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1 w-full overflow-hidden rounded-full bg-line-strong">
        <div className="h-full rounded-full bg-foreground transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="timecode w-8 shrink-0 text-right text-[11px] text-muted">{Math.round(pct)}%</span>
    </div>
  );
}
