"use client";

import { useState } from "react";
import { LIVE_DURATIONS, requestLiveClip } from "@/lib/live";

/** "Clip ahora": un toque crea un job live_clip con requested_at = ahora. */
export function LiveClipRow({ url }: { url: string }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function clip(d: number) {
    setBusy(d);
    setMsg(null);
    try {
      await requestLiveClip(url, d);
      setMsg({ ok: true, text: `Clip de ${d} s en camino. Aparecerá en Fuentes cuando el worker lo procese.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Error inesperado" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="label-mono">Clip ahora</div>
      <div className="flex flex-wrap gap-2">
        {LIVE_DURATIONS.map((d) => (
          <button
            key={d}
            disabled={busy !== null}
            onClick={() => clip(d)}
            className="chip timecode min-h-10 min-w-14 disabled:opacity-50"
          >
            {busy === d ? "..." : `${d} s`}
          </button>
        ))}
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
