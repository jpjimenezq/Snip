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
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-white/10 bg-surface p-4">
      <h2 className="font-semibold">Clip manual</h2>
      <div>
        <label className="mb-1 block text-xs text-zinc-400">Momento (ss, mm:ss o hh:mm:ss)</label>
        <input
          value={ts}
          onChange={(e) => setTs(e.target.value)}
          placeholder="12:34"
          inputMode="numeric"
          className="h-11 w-full rounded-lg border border-white/10 bg-bg px-3 outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-zinc-500">El clip termina en ese momento y empieza la duración elegida antes.</p>
      </div>
      <div>
        <label className="mb-1 block text-xs text-zinc-400">Duración</label>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <button
              type="button"
              key={d}
              onClick={() => setDuration(d)}
              className={`rounded-full px-3 py-1.5 text-sm ${duration === d ? "bg-accent text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`}
            >
              {d} s
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDuration("custom")}
            className={`rounded-full px-3 py-1.5 text-sm ${duration === "custom" ? "bg-accent text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10"}`}
          >
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
            className="mt-2 h-11 w-32 rounded-lg border border-white/10 bg-bg px-3 outline-none focus:border-accent"
          />
        )}
      </div>
      <button
        disabled={busy || disabled || !ts.trim()}
        className="h-11 w-full rounded-lg bg-accent font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        {busy ? "Creando..." : "Crear clip"}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
    </form>
  );
}
