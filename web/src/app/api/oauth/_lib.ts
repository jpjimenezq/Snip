// Utilidades compartidas por las rutas OAuth (solo servidor).
import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OAuthPlatform = "youtube" | "tiktok" | "facebook";

/** Variables de entorno necesarias por plataforma (instagram usa las de Meta). */
export const REQUIRED_ENV: Record<"youtube" | "tiktok" | "instagram" | "facebook", string[]> = {
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  facebook: ["META_APP_ID", "META_APP_SECRET"],
  instagram: ["META_APP_ID", "META_APP_SECRET"],
};

export const isConfigured = (p: keyof typeof REQUIRED_ENV) => REQUIRED_ENV[p].every((k) => !!process.env[k]);

export const META_GRAPH = "https://graph.facebook.com/v23.0";
export const DEFAULT_META_SCOPES =
  "pages_show_list,pages_read_engagement,pages_manage_posts,publish_video,instagram_basic,instagram_content_publish,business_management";

export function baseUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  return env || req.nextUrl.origin;
}

export function redirectUri(req: NextRequest, platform: OAuthPlatform): string {
  return `${baseUrl(req)}/api/oauth/${platform}/callback`;
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256b64url = (s: string) => createHash("sha256").update(s).digest("base64url");

export const cookieName = (p: string) => `snip_oauth_${p}`;

export function toSettings(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL("/settings", baseUrl(req));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v.slice(0, 300));
  return NextResponse.redirect(url);
}

/** Usuario de la sesión, o null. */
export async function sessionUser(supabase: SupabaseClient) {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

export interface SaveAccountArgs {
  platform: "youtube" | "tiktok" | "instagram" | "facebook";
  externalId: string;
  name: string;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
  extra?: Record<string, unknown>;
}

/** Guarda con el RPC (sesión del usuario): los tokens nunca pasan por el navegador. */
export async function saveAccount(supabase: SupabaseClient, a: SaveAccountArgs): Promise<void> {
  const { error } = await supabase.rpc("save_social_account", {
    p_platform: a.platform,
    p_external_id: a.externalId,
    p_name: a.name,
    p_avatar_url: a.avatarUrl ?? null,
    p_access_token: a.accessToken,
    p_refresh_token: a.refreshToken ?? null,
    p_expires_at: a.expiresAt ? a.expiresAt.toISOString() : null,
    p_scope: a.scope ?? null,
    p_extra: a.extra ?? {},
  });
  if (error) throw new Error(`No se pudo guardar la cuenta: ${error.message}`);
}

export const expiresIn = (seconds?: number | string | null): Date | null => {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(Date.now() + n * 1000) : null;
};

export async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(url, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo JSON */
  }
  return { ok: res.ok, status: res.status, data: data ?? {} };
}
