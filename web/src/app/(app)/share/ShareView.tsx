"use client";

import { useSearchParams } from "next/navigation";
import { UrlForm } from "@/components/UrlForm";
import { extractUrl } from "@/lib/url";

export function ShareView() {
  const params = useSearchParams();
  const url = extractUrl(params.get("url"), params.get("text"), params.get("title"));
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Enlace compartido</h1>
      {url ? (
        <>
          <p className="break-all rounded-xl border border-white/10 bg-surface p-3 text-sm text-zinc-300">{url}</p>
          <UrlForm key={url} initialUrl={url} />
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-400">No se encontró ningún enlace en lo compartido. Pégalo manualmente:</p>
          <UrlForm />
        </>
      )}
    </div>
  );
}
