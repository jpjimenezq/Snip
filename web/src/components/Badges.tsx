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
  queued_render: "En cola de render",
  rendering: "Renderizando",
  rendered: "Renderizado",
  error: "Error",
};

function tone(status: string): string {
  if (status === "ready" || status === "rendered") return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
  if (status === "error") return "bg-red-500/15 text-red-300 ring-red-500/30";
  if (status === "suggested") return "bg-sky-500/15 text-sky-300 ring-sky-500/30";
  if (status === "queued" || status === "queued_render") return "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30";
  return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
}

export function isBusy(status: string): boolean {
  return ["downloading", "transcribing", "analyzing", "rendering", "queued", "queued_render"].includes(status);
}

export function StatusChip({ status, kind }: { status: SourceStatus | ClipStatus; kind: "source" | "clip" }) {
  const label = kind === "source" ? SOURCE_LABEL[status as SourceStatus] : CLIP_LABEL[status as ClipStatus];
  const pulse = ["downloading", "transcribing", "analyzing", "rendering"].includes(status);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone(status)}`}>
      {pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {label ?? status}
    </span>
  );
}

const PLATFORM: Record<Platform, { label: string; cls: string }> = {
  youtube: { label: "YouTube", cls: "bg-red-500/15 text-red-300" },
  kick: { label: "Kick", cls: "bg-lime-500/15 text-lime-300" },
  twitch: { label: "Twitch", cls: "bg-purple-500/15 text-purple-300" },
  other: { label: "Otro", cls: "bg-zinc-500/15 text-zinc-300" },
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  const p = PLATFORM[platform] ?? PLATFORM.other;
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${p.cls}`}>{p.label}</span>;
}

const ORIGIN: Record<ClipOrigin, string> = { ai: "IA", manual: "Manual", hotkey: "Atajo" };

export function OriginBadge({ origin }: { origin: ClipOrigin }) {
  return (
    <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium text-zinc-200">
      {ORIGIN[origin] ?? origin}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const cls =
    score >= 80 ? "bg-emerald-500 text-emerald-950" : score >= 60 ? "bg-amber-400 text-amber-950" : "bg-zinc-400 text-zinc-900";
  return <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${cls}`}>{score}</span>;
}

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}
