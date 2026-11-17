"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function TrashIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
    </svg>
  );
}

/** Diálogo de confirmación accesible (reemplaza window.confirm). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Eliminar",
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  const cancelFn = useRef(onCancel);
  useEffect(() => {
    busyRef.current = busy;
    cancelFn.current = onCancel;
  });

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busyRef.current) cancelFn.current();
      } else if (e.key === "Tab") {
        const els = [cancelRef.current, confirmRef.current].filter((x): x is HTMLButtonElement => !!x && !x.disabled);
        if (els.length === 0) return;
        const i = els.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        els[(i + (e.shiftKey ? els.length - 1 : 1)) % els.length].focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-white/10 bg-surface p-5 shadow-2xl"
      >
        <h2 id="confirm-title" className="text-lg font-bold">
          {title}
        </h2>
        <div id="confirm-desc" className="mt-2 space-y-2 text-sm text-zinc-300">
          {children}
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-11 rounded-lg bg-white/10 px-4 text-sm font-semibold hover:bg-white/15 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-11 rounded-lg bg-red-500 px-4 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Eliminando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
