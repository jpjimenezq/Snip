/** Parsea "ss", "mm:ss" o "hh:mm:ss" (admite decimales en los segundos). null si es inválido. */
export function parseTimestamp(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (!/^\d+(\.\d+)?$/.test(p)) return null;
    // solo el último componente admite decimales
    if (i < parts.length - 1 && p.includes(".")) return null;
    total = total * 60 + parseFloat(p);
  }
  return total;
}

/** mm:ss (o h:mm:ss si pasa de una hora). */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${String(m).padStart(2, "0")}:${ss}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds * 10) / 10;
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
}

export function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}
