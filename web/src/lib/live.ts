import type { Platform } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { detectPlatform, isValidUrl, youtubeId } from "@/lib/url";

export type LiveStatus = "idle" | "offline" | "recording" | "error";

/** Refleja public.live_watches (supabase/migrations/0002_live_publish.sql). */
export interface LiveWatch {
  id: string;
  user_id: string;
  url: string;
  platform: Platform;
  channel: string | null;
  enabled: boolean;
  status: LiveStatus;
  buffer_s: number;
  error: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export const LIVE_DURATIONS = [5, 10, 15, 30, 45, 60];
/** Sin latido del worker durante tanto tiempo => se considera caído. */
export const HEARTBEAT_STALE_S = 60;

/** Normaliza el enlace igual que el worker (live_utils.normalize_live_url). */
export function normalizeLiveUrl(raw: string): { url: string; platform: Platform; channel: string | null } | null {
  let text = raw.trim();
  if (!text) return null;
  if (!/^[a-z]+:\/\//i.test(text)) text = "https://" + text;
  if (!isValidUrl(text)) return null;
  const u = new URL(text);
  const platform = detectPlatform(text);
  const parts = u.pathname.split("/").filter(Boolean);
  if (platform === "kick" || platform === "twitch") {
    const ch = parts[0]?.toLowerCase();
    if (!ch || ["video", "videos", "directory", "categories", "browse"].includes(ch)) return null;
    return { url: `https://${platform === "kick" ? "kick.com" : "twitch.tv"}/${ch}`, platform, channel: ch };
  }
  if (platform === "youtube") {
    const id = youtubeId(text);
    if (id) return { url: `https://www.youtube.com/watch?v=${id}`, platform, channel: id };
    if (parts[0]?.startsWith("@")) {
      const h = parts[0].toLowerCase();
      return { url: `https://www.youtube.com/${h}/live`, platform, channel: h };
    }
    return null;
  }
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, "")}`, platform: "other", channel: parts[0] ?? u.hostname };
}

export function heartbeatAgeS(w: Pick<LiveWatch, "last_seen_at">, now = Date.now()): number | null {
  if (!w.last_seen_at) return null;
  return Math.max(0, (now - new Date(w.last_seen_at).getTime()) / 1000);
}

export function formatAge(s: number): string {
  if (s < 5) return "ahora";
  if (s < 60) return `hace ${Math.floor(s)} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  return `hace ${Math.floor(s / 3600)} h`;
}

export function formatBuffer(s: number): string {
  const min = s / 60;
  return min < 1 ? `${Math.round(s)} s` : `${min < 10 ? min.toFixed(1) : Math.round(min)} min`;
}

async function userId(): Promise<string> {
  const { data, error } = await createClient().auth.getUser();
  if (error || !data.user) throw new Error("Sesión expirada. Vuelve a iniciar sesión.");
  return data.user.id;
}

export async function addLiveWatch(raw: string): Promise<void> {
  const n = normalizeLiveUrl(raw);
  if (!n) throw new Error("Pega el enlace de un canal en vivo (kick.com/canal, twitch.tv/canal o un directo de YouTube).");
  const user_id = await userId();
  const { error } = await createClient()
    .from("live_watches")
    .insert({ user_id, url: n.url, platform: n.platform, channel: n.channel, enabled: true });
  if (error) {
    if (error.code === "23505") throw new Error("Ese canal ya está en la lista.");
    throw new Error(error.message);
  }
}

export async function setLiveEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await createClient().from("live_watches").update({ enabled }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteLiveWatch(id: string): Promise<void> {
  const { error } = await createClient().from("live_watches").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Pide un clip del búfer en vivo: el tramo termina "ahora" (menos el retardo del worker). */
export async function requestLiveClip(url: string, duration_s: number): Promise<void> {
  const user_id = await userId();
  const { error } = await createClient()
    .from("jobs")
    .insert({ user_id, type: "live_clip", payload: { url, duration_s, requested_at: new Date().toISOString() } });
  if (error) throw new Error(error.message);
}
