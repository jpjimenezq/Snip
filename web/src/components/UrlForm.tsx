"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSourceFromUrl } from "@/lib/actions";
import { detectPlatform, isValidUrl } from "@/lib/url";
import { PlatformBadge } from "./Badges";

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
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus={autoFocus}
          inputMode="url"
          placeholder="Pega un enlace (YouTube, Kick VOD, Twitch VOD)"
          className="h-14 w-full rounded-xl sm:flex-1 border border-white/10 bg-surface px-4 text-base outline-none placeholder:text-zinc-500 focus:border-accent"
        />
        <button
          disabled={busy || !trimmed}
          className="h-14 rounded-xl bg-accent px-6 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Creando..." : "Procesar"}
        </button>
      </div>
      <div className="flex min-h-5 items-center gap-2 text-sm">
        {valid && <PlatformBadge platform={detectPlatform(trimmed)} />}
        {error && <span className="text-red-400">{error}</span>}
      </div>
    </form>
  );
}
