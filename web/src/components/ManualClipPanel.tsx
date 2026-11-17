"use client";

import { useState } from "react";
import { createJob } from "@/lib/actions";
import { formatTime, parseTimestamp } from "@/lib/time";

const DURATIONS = [5, 10, 15, 30, 45, 60];

export function ManualClipPanel({ sourceId, disabled }: { sourceId: string; disabled?: boolean }) {
  const [ts, setTs] = useState("");
  const [duration, setDuration] = useState<number | "custom">(30);
  const [custom, setCustom] = useState("30");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const at_s = parseTimestamp(ts);
    const duration_s = duration === "custom" ? parseFloat(custom) : duration;
    if (at_s == null) return setMsg({ ok: false, text: "Tiempo inválido. Usa ss, mm:ss o hh:mm:ss." });
    if (!Number.isFinite(duration_s) || duration_s <= 0)
      return setMsg({ ok: false, text: "Duración inválida." });
    setBusy(true);
    setMsg(null);
    try {
      await createJob("manual_clip", { source_id: sourceId, at_s, duration_s });
      setMsg({
        ok: true,
        text: `Clip en cola: ${formatTime(Math.max(0, at_s - duration_s))} – ${formatTime(at_s)}. Aparecerá abajo cuando el worker lo cree.`,
      });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Error inesperado" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel space-y-4 p-4">
      <h2 className="text-sm font-semibold">Clip manual</h2>
      <div>
        <label className="mb-1.5 block text-xs text-muted">Momento (ss, mm:ss o hh:mm:ss)</label>
        <input
          value={ts}
          onChange={(e) => setTs(e.target.value)}
          placeholder="12:34"
          inputMode="numeric"
          className="field timecode"
        />
        <p className="mt-1.5 text-xs text-faint">El clip termina en ese momento y empieza la duración elegida antes.</p>
      </div>
      <div>
        <label className="mb-1.5 block text-xs text-muted">Duración</label>
        <div className="flex flex-wrap gap-1.5">
          {DURATIONS.map((d) => (
            <button type="button" key={d} onClick={() => setDuration(d)} aria-pressed={duration === d} className="chip timecode min-h-10">
              {d} s
            </button>
          ))}
          <button type="button" onClick={() => setDuration("custom")} aria-pressed={duration === "custom"} className="chip min-h-10">
            Personalizado
          </button>
        </div>
        {duration === "custom" && (
          <input
            type="number"
            min={1}
            step={1}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-label="Duración en segundos"
            className="field timecode mt-2 w-32"
          />
        )}
      </div>
      <button disabled={busy || disabled || !ts.trim()} className="btn btn-primary w-full">
        {busy ? "Creando..." : "Crear clip"}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </form>
  );
}
