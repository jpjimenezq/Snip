// Piezas visuales compartidas (estilo sobrio, ver app/globals.css).
import Link from "next/link";
import type { ReactNode } from "react";

/** Marca: cuadro blanco con unas tijeras negras. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#ededef" />
      <g stroke="#0c0c0e" strokeWidth="2.6" fill="none" strokeLinecap="round">
        <circle cx="10.5" cy="21.5" r="3.6" />
        <circle cx="21.5" cy="21.5" r="3.6" />
        <path d="M13 18.8 L22.5 7.5 M19 18.8 L9.5 7.5" />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return <span className="text-[1.05rem] font-semibold tracking-tight">Snip</span>;
}

/** Encabezado de sección: título + contador/acción opcional. */
export function SectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  /** Compatibilidad con versiones anteriores; se ignoran. */
  index?: string;
  emoji?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-baseline gap-2 text-[0.95rem] font-semibold">
        {title}
        {count != null && <span className="timecode text-sm font-normal text-muted">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

/** Título de página con descripción opcional. */
export function PageTitle({
  title,
  children,
  actions,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  kicker?: string;
  emoji?: string;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl sm:text-[1.75rem]">{title}</h1>
        {children && <div className="mt-1.5 max-w-2xl text-sm text-muted">{children}</div>}
      </div>
      {actions}
    </header>
  );
}

/** Punto rojo de "en vivo". */
export function RecDot({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full bg-live animate-rec ${className}`} aria-hidden="true" />;
}

export function Timecode({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`timecode ${className}`}>{children}</span>;
}

export function LinkArrow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="flex h-9 items-center gap-1 text-sm text-muted transition hover:text-foreground">
      {children} <span aria-hidden="true">›</span>
    </Link>
  );
}

/** Estado vacío con pasos numerados. */
export function EmptySteps({ title, steps }: { title: string; steps: ReactNode[]; emojis?: string[] }) {
  return (
    <div className="panel p-5">
      <p className="mb-4 text-sm font-medium">{title}</p>
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="timecode flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs text-muted">
              {i + 1}
            </span>
            <div className="text-sm leading-relaxed text-muted">{s}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Aviso en línea. */
export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "warn" | "error"; children: ReactNode }) {
  const dot = { info: "bg-info", ok: "bg-ok", warn: "bg-warn", error: "bg-danger" }[tone];
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-line bg-raised px-3 py-2.5 text-sm text-zinc-300">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <div>{children}</div>
    </div>
  );
}

/** Dato pequeño etiqueta/valor para las tarjetas. */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="timecode truncate text-[13px] text-zinc-200">{value}</dd>
    </div>
  );
}
