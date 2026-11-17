"use strict";
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = ok ? "ok" : "err";
}

function updateLink(panelUrl) {
  const a = $("open");
  a.style.display = panelUrl ? "" : "none";
  if (panelUrl) a.href = panelUrl;
}

async function load() {
  const cfg = await snipGetConfig();
  $("supabaseUrl").value = cfg.supabaseUrl || "";
  $("anonKey").value = cfg.anonKey || "";
  $("email").value = cfg.email || "";
  $("panelUrl").value = cfg.panelUrl || "";
  updateLink(cfg.panelUrl);
  if (cfg.refreshToken) setStatus(`Sesión iniciada como ${cfg.email || "usuario"}.`, true);
}

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const supabaseUrl = snipBase($("supabaseUrl").value);
  const anonKey = $("anonKey").value.trim();
  const email = $("email").value.trim();
  const password = $("password").value;
  const panelUrl = snipBase($("panelUrl").value);
  await chrome.storage.local.set({ supabaseUrl, anonKey, email, panelUrl });
  updateLink(panelUrl);
  if (!password) {
    const cfg = await snipGetConfig();
    return setStatus(cfg.refreshToken ? "Ajustes guardados (la sesión sigue activa)." : "Escribe tu contraseña para iniciar sesión.", !!cfg.refreshToken);
  }
  setStatus("Iniciando sesión...", true);
  try {
    await snipLogin(supabaseUrl, anonKey, email, password);
    $("password").value = ""; // la contraseña nunca se guarda
    setStatus(`Sesión iniciada como ${email}.`, true);
  } catch (err) {
    setStatus(err.message, false);
  }
});

$("logout").addEventListener("click", async () => {
  await chrome.storage.local.remove(["accessToken", "refreshToken", "expiresAt", "userId"]);
  setStatus("Sesión cerrada.", true);
});

load();
