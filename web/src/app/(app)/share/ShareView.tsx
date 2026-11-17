"use client";

import { useSearchParams } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { UrlForm } from "@/components/UrlForm";
import { extractUrl } from "@/lib/url";

export function ShareView() {
  const params = useSearchParams();
  const url = extractUrl(params.get("url"), params.get("text"), params.get("title"));
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle title="Enlace compartido">Crea clips a partir del enlace que compartiste con Snip.</PageTitle>
      {url ? (
        <>
          <p className="break-all panel p-3 text-sm text-muted">{url}</p>
          <UrlForm key={url} initialUrl={url} />
        </>
      ) : (
        <>
          <p className="text-sm text-muted">No se encontró ningún enlace en lo compartido. Pégalo manualmente:</p>
          <UrlForm />
        </>
      )}
    </div>
  );
}
