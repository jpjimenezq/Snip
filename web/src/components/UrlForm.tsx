"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSourceFromUrl } from "@/lib/actions";
import { detectPlatform, isValidUrl } from "@/lib/url";
import { PlatformBadge } from "./Badges";

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" strokeLinecap="round" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" strokeLinecap="round" />
    </svg>
  );
}

export function UrlForm({ initialUrl = "", autoFocus = false }: { initialUrl?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = url.trim();
  const valid = isValidUrl(trimmed);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError("Pega un enlace válido (https://...)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await createSourceFromUrl(trimmed);
      router.push(`/sources/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <div className="flex flex-col gap-2 rounded-xl border border-line-strong bg-surface p-1.5 transition focus-within:border-muted sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2.5 pl-2.5 text-muted">
          <LinkIcon />
          <span className="sr-only">Enlace del video</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus={autoFocus}
            inputMode="url"
            placeholder="Pega el enlace de YouTube, Kick o Twitch"
            className="h-11 w-full min-w-0 bg-transparent text-[0.95rem] text-foreground outline-none placeholder:text-faint"
          />
        </label>
        <button disabled={busy || !trimmed} className="btn btn-primary h-11 px-5">
          {busy ? "Creando…" : "Obtener clips"}
        </button>
      </div>
      <div className="flex min-h-5 flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {valid ? (
          <PlatformBadge platform={detectPlatform(trimmed)} />
        ) : (
          <span className="text-xs text-faint">Funciona con directos guardados, VODs y videos de YouTube</span>
        )}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </form>
  );
}
