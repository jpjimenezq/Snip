import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  META_GRAPH,
  cookieName,
  expiresIn,
  fetchJson,
  isConfigured,
  redirectUri,
  saveAccount,
  sessionUser,
  toSettings,
  type OAuthPlatform,
} from "../../_lib";
import type { SupabaseClient } from "@supabase/supabase-js";

type Result = { connected: string; count: number };

export async function GET(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  const { platform: raw } = await ctx.params;
  const platform = (raw === "instagram" ? "facebook" : raw) as OAuthPlatform;
  if (!["youtube", "tiktok", "facebook"].includes(platform)) {
    return toSettings(req, { error: "Plataforma desconocida" });
  }
  const q = req.nextUrl.searchParams;

  // Estado + verificador guardados por /start.
  const cookie = req.cookies.get(cookieName(platform))?.value;
  let saved: { state?: string; verifier?: string } = {};
  try {
    saved = cookie ? JSON.parse(cookie) : {};
  } catch {
    /* cookie corrupta */
  }
  const finish = (params: Record<string, string>) => {
    const res = toSettings(req, params);
    res.cookies.delete({ name: cookieName(platform), path: "/api/oauth" });
    return res;
  };

  const providerError = q.get("error_description") || q.get("error") || q.get("error_reason");
  if (providerError) return finish({ error: providerError });
  if (!saved.state || saved.state !== q.get("state")) {
    return finish({ error: "Estado OAuth inválido o caducado. Intenta conectar de nuevo." });
  }
  const code = q.get("code");
  if (!code) return finish({ error: "El proveedor no devolvió un código de autorización." });
  if (!isConfigured(platform)) return finish({ error: "Faltan variables de entorno (ver docs/PUBLISHING.md)" });

  const supabase = await createClient();
  if (!(await sessionUser(supabase))) return finish({ error: "Tu sesión expiró. Inicia sesión y vuelve a conectar." });

  try {
    const redirect = redirectUri(req, platform);
    let r: Result;
    if (platform === "youtube") r = await youtube(supabase, code, redirect, saved.verifier ?? "");
    else if (platform === "tiktok") r = await tiktok(supabase, code, redirect);
    else r = await meta(supabase, code, redirect);
    return finish({ connected: raw === "instagram" ? "instagram" : r.connected, n: String(r.count) });
  } catch (e) {
    return finish({ error: e instanceof Error ? e.message : "Error desconocido al conectar" });
  }
}

const form = (o: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(o).toString(),
});

// ---------------------------------------------------------------- YouTube
async function youtube(supabase: SupabaseClient, code: string, redirect: string, verifier: string): Promise<Result> {
  const tok = await fetchJson(
    "https://oauth2.googleapis.com/token",
    form({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirect,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  );
  if (!tok.ok || !tok.data.access_token) {
    throw new Error(`Google rechazó el código: ${tok.data.error_description ?? tok.data.error ?? tok.status}`);
  }
  const ch = await fetchJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${tok.data.access_token}` },
  });
  const item = ch.data.items?.[0];
  if (!ch.ok || !item) {
    throw new Error(
      "No se encontró ningún canal de YouTube en esa cuenta de Google (crea un canal primero) o la API no está habilitada.",
    );
  }
  await saveAccount(supabase, {
    platform: "youtube",
    externalId: item.id,
    name: item.snippet?.title ?? "Canal de YouTube",
    avatarUrl: item.snippet?.thumbnails?.default?.url ?? null,
    accessToken: tok.data.access_token,
    refreshToken: tok.data.refresh_token ?? null,
    expiresAt: expiresIn(tok.data.expires_in),
    scope: tok.data.scope ?? null,
  });
  return { connected: "youtube", count: 1 };
}

// ---------------------------------------------------------------- TikTok
async function tiktok(supabase: SupabaseClient, code: string, redirect: string): Promise<Result> {
  const tok = await fetchJson(
    "https://open.tiktokapis.com/v2/oauth/token/",
    form({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirect,
    }),
  );
  if (!tok.ok || !tok.data.access_token) {
    throw new Error(`TikTok rechazó el código: ${tok.data.error_description ?? tok.data.error ?? tok.status}`);
  }
  const info = await fetchJson(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name",
    { headers: { Authorization: `Bearer ${tok.data.access_token}` } },
  );
  const user = info.data?.data?.user ?? {};
  const openId = user.open_id ?? tok.data.open_id;
  if (!openId) throw new Error("TikTok no devolvió el identificador del usuario.");
  await saveAccount(supabase, {
    platform: "tiktok",
    externalId: openId,
    name: user.display_name ?? "Cuenta de TikTok",
    avatarUrl: user.avatar_url ?? null,
    accessToken: tok.data.access_token,
    refreshToken: tok.data.refresh_token ?? null,
    expiresAt: expiresIn(tok.data.expires_in),
    scope: tok.data.scope ?? null,
    extra: { refresh_expires_in: tok.data.refresh_expires_in ?? null },
  });
  return { connected: "tiktok", count: 1 };
}

// ---------------------------------------------------------------- Meta (Facebook + Instagram)
interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
}

async function meta(supabase: SupabaseClient, code: string, redirect: string): Promise<Result> {
  const appId = process.env.META_APP_ID!;
  const secret = process.env.META_APP_SECRET!;
  const short = await fetchJson(
    `${META_GRAPH}/oauth/access_token?` +
      new URLSearchParams({ client_id: appId, client_secret: secret, redirect_uri: redirect, code }),
  );
  if (!short.ok || !short.data.access_token) {
    throw new Error(`Meta rechazó el código: ${short.data.error?.message ?? short.status}`);
  }
  // Token de usuario de larga duración (~60 días). Los tokens de página derivados de él no caducan.
  const long = await fetchJson(
    `${META_GRAPH}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: secret,
        fb_exchange_token: short.data.access_token,
      }),
  );
  const userToken: string = long.ok && long.data.access_token ? long.data.access_token : short.data.access_token;

  const pagesRes = await fetchJson(
    `${META_GRAPH}/me/accounts?` +
      new URLSearchParams({
        fields: "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
        limit: "100",
        access_token: userToken,
      }),
  );
  if (!pagesRes.ok) throw new Error(`No se pudieron listar tus páginas: ${pagesRes.data.error?.message ?? pagesRes.status}`);
  const pages: MetaPage[] = pagesRes.data.data ?? [];
  if (pages.length === 0) {
    throw new Error(
      "No se encontró ninguna página de Facebook. Debes ser administrador de una página y marcarla al autorizar.",
    );
  }

  let count = 0;
  let igCount = 0;
  for (const page of pages) {
    await saveAccount(supabase, {
      platform: "facebook",
      externalId: page.id,
      name: page.name,
      avatarUrl: page.picture?.data?.url ?? null,
      accessToken: page.access_token,
      expiresAt: null, // los page tokens de larga duración no expiran
      scope: process.env.META_SCOPES ?? null,
      extra: { page_access_token: page.access_token, page_id: page.id },
    });
    count++;
    const ig = page.instagram_business_account;
    if (ig?.id) {
      await saveAccount(supabase, {
        platform: "instagram",
        externalId: ig.id,
        name: ig.username ? `@${ig.username}` : (ig.name ?? "Instagram"),
        avatarUrl: ig.profile_picture_url ?? null,
        accessToken: page.access_token,
        expiresAt: null,
        extra: { ig_user_id: ig.id, page_id: page.id, page_access_token: page.access_token },
      });
      igCount++;
    }
  }
  return { connected: "facebook", count: count + igCount };
}
