// Utilidades compartidas (service worker y página de opciones). Sin dependencias.
"use strict";

const SNIP_KEYS = ["supabaseUrl", "anonKey", "panelUrl", "email", "accessToken", "refreshToken", "expiresAt", "userId"];

async function snipGetConfig() {
  return chrome.storage.local.get(SNIP_KEYS);
}

function snipBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function snipJwtSub(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="))).sub || null;
  } catch {
    return null;
  }
}

async function snipSaveSession(data) {
  const expiresAt = data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000;
  await chrome.storage.local.set({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    userId: (data.user && data.user.id) || snipJwtSub(data.access_token)
  });
}

async function snipAuthRequest(cfg, grant, body) {
  const res = await fetch(`${snipBase(cfg.supabaseUrl)}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.msg || json.message || `Error de autenticación (${res.status})`);
  }
  return json;
}

// Inicia sesión con correo y contraseña. La contraseña NO se guarda.
async function snipLogin(supabaseUrl, anonKey, email, password) {
  const cfg = { supabaseUrl, anonKey };
  const data = await snipAuthRequest(cfg, "password", { email, password });
  await snipSaveSession(data);
}

// Devuelve { cfg, token, userId } con el token vigente (lo refresca si caduca en < 60 s).
async function snipSession() {
  const cfg = await snipGetConfig();
  if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.refreshToken) {
    throw new Error("Configura Snip: abre las opciones de la extensión e inicia sesión.");
  }
  if (!cfg.accessToken || !cfg.expiresAt || cfg.expiresAt - Date.now() < 60000) {
    const data = await snipAuthRequest(cfg, "refresh_token", { refresh_token: cfg.refreshToken });
    await snipSaveSession(data);
    return snipSession();
  }
  const userId = cfg.userId || snipJwtSub(cfg.accessToken);
  if (!userId) throw new Error("No se pudo leer el usuario de la sesión. Vuelve a iniciar sesión.");
  return { cfg, token: cfg.accessToken, userId };
}

// Llamada REST a PostgREST con el JWT del usuario (aplica RLS).
async function snipRest(path, { method = "GET", body, prefer } = {}) {
  const { cfg, token } = await snipSession();
  const headers = { apikey: cfg.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${snipBase(cfg.supabaseUrl)}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
  if (!res.ok) throw new Error((json && (json.message || json.hint)) || `Error ${res.status} al hablar con Supabase`);
  return json;
}
