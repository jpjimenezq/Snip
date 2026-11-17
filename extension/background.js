// Service worker de Snip: atajo, inyección del panel y llamadas REST con el JWT del usuario.
"use strict";
importScripts("lib.js");

function notify(message, title = "Snip") {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message: String(message).slice(0, 300)
  });
}

// La hora de la pulsación se captura AQUÍ, antes de elegir la duración.
async function openOverlay(tab) {
  const requestedAt = new Date().toISOString();
  if (!tab || !tab.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    notify("Abre un directo o un video en la pestaña activa y vuelve a intentarlo.");
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (at) => window.__snipOpen && window.__snipOpen(at),
      args: [requestedAt]
    });
  } catch (err) {
    notify(`No pude abrir el panel en esta página: ${err.message}`);
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "clip") openOverlay(await activeTab());
});
chrome.action.onClicked.addListener((tab) => openOverlay(tab));

// ---------------------------------------------------------------- URLs
function youtubeId(u) {
  if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  const v = u.searchParams.get("v");
  if (v) return v;
  const m = u.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]{6,})/);
  return m ? m[1] : null;
}

function platformOf(u) {
  const h = u.hostname.toLowerCase();
  if (h === "youtu.be" || h.endsWith("youtube.com")) return "youtube";
  if (h.endsWith("kick.com")) return "kick";
  if (h.endsWith("twitch.tv")) return "twitch";
  return "other";
}

function canonicalUrl(raw) {
  const u = new URL(raw);
  if (platformOf(u) === "youtube") {
    const id = youtubeId(u);
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

function liveUrl(raw) {
  const u = new URL(raw);
  const p = platformOf(u);
  const parts = u.pathname.split("/").filter(Boolean);
  if (p === "kick" || p === "twitch") return `https://${p === "kick" ? "kick.com" : "twitch.tv"}/${(parts[0] || "").toLowerCase()}`;
  return canonicalUrl(raw);
}

// ---------------------------------------------------------------- acciones
async function insertJob(userId, type, payload) {
  await snipRest("jobs", { method: "POST", body: { user_id: userId, type, payload }, prefer: "return=minimal" });
}

async function doLive(msg, userId) {
  await insertJob(userId, "live_clip", {
    url: liveUrl(msg.pageUrl),
    duration_s: msg.duration_s,
    requested_at: msg.requestedAt
  });
  return "Clip en camino";
}

async function doVod(msg, userId) {
  const canon = canonicalUrl(msg.pageUrl);
  const candidates = [...new Set([canon, msg.pageUrl.split("#")[0]])];
  const filter = candidates.map((c) => `url.eq."${c.replace(/"/g, "")}"`).join(",");
  const found = await snipRest(`sources?select=id&or=(${encodeURIComponent(filter)})&order=created_at.desc&limit=1`);
  let sourceId = found && found[0] && found[0].id;
  if (!sourceId) {
    const created = await snipRest("sources", {
      method: "POST",
      body: { user_id: userId, url: canon, platform: platformOf(new URL(canon)), status: "queued" },
      prefer: "return=representation"
    });
    sourceId = created[0].id;
    await insertJob(userId, "process_source", { source_id: sourceId });
  }
  const at_s = Math.max(0, Math.round((msg.currentTime || 0) * 10) / 10);
  await insertJob(userId, "manual_clip", { source_id: sourceId, at_s, duration_s: msg.duration_s });
  return "Clip en camino";
}

async function handleClip(msg) {
  const { userId } = await snipSession();
  const text = msg.live ? await doLive(msg, userId) : await doVod(msg, userId);
  return { ok: true, message: text };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "snip-clip") return false;
  handleClip(msg)
    .then(sendResponse)
    .catch((err) => {
      notify(err.message, "Snip: no se pudo crear el clip");
      sendResponse({ ok: false, message: err.message });
    });
  return true; // respuesta asíncrona
});

chrome.runtime.onInstalled.addListener((info) => {
  if (info.reason === "install") chrome.runtime.openOptionsPage();
});
