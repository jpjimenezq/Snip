import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_META_SCOPES,
  baseUrl,
  cookieName,
  isConfigured,
  randomToken,
  redirectUri,
  sessionUser,
  sha256b64url,
  toSettings,
  type OAuthPlatform,
} from "../../_lib";

export async function GET(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  const { platform: raw } = await ctx.params;
  // Instagram se conecta con el mismo login de Meta que Facebook.
  const platform = (raw === "instagram" ? "facebook" : raw) as OAuthPlatform;
  if (!["youtube", "tiktok", "facebook"].includes(platform)) {
    return NextResponse.json({ error: "Plataforma desconocida" }, { status: 404 });
  }

  const supabase = await createClient();
  if (!(await sessionUser(supabase))) {
    const login = new URL("/login", baseUrl(req));
    login.searchParams.set("next", "/settings");
    return NextResponse.redirect(login);
  }
  if (!isConfigured(platform)) {
    return toSettings(req, { error: `Falta configurar las credenciales de ${raw} (ver docs/PUBLISHING.md)` });
  }

  const state = randomToken(24);
  const verifier = randomToken(48);
  const redirect = redirectUri(req, platform);
  let authUrl: URL;

  if (platform === "youtube") {
    authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirect,
      response_type: "code",
      scope: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
      ].join(" "),
      access_type: "offline",
      prompt: "consent", // fuerza refresh_token aunque ya se haya autorizado antes
      include_granted_scopes: "true",
      state,
      code_challenge: sha256b64url(verifier),
      code_challenge_method: "S256",
    }).toString();
  } else if (platform === "tiktok") {
    // Flujo web con client_secret en el servidor: sin PKCE (TikTok lo exige solo en apps de escritorio).
    authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
    authUrl.search = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      scope: "user.info.basic,video.upload,video.publish",
      response_type: "code",
      redirect_uri: redirect,
      state,
    }).toString();
  } else {
    authUrl = new URL("https://www.facebook.com/v23.0/dialog/oauth");
    authUrl.search = new URLSearchParams({
      client_id: process.env.META_APP_ID!,
      redirect_uri: redirect,
      response_type: "code",
      scope: process.env.META_SCOPES?.trim() || DEFAULT_META_SCOPES,
      state,
    }).toString();
  }

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(cookieName(platform), JSON.stringify({ state, verifier }), {
    httpOnly: true,
    sameSite: "lax", // el callback es una navegación de primer nivel desde el proveedor
    secure: req.nextUrl.protocol === "https:",
    path: "/api/oauth",
    maxAge: 600,
  });
  return res;
}
