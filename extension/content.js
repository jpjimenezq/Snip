// Panel flotante "Snip · ¿cuánto clip?" inyectado en la pestaña activa.
(() => {
  "use strict";
  if (window.__snipOpen) return; // ya inyectado: solo se vuelve a llamar a __snipOpen

  const DURATIONS = [5, 10, 15, 30, 45, 60];
  let host = null;
  let state = null;

  function detectContext() {
    const u = new URL(location.href);
    const h = u.hostname.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    const video = document.querySelector("video");
    const currentTime = video && isFinite(video.currentTime) ? video.currentTime : 0;
    let live = false;
    let kind = "VOD";
    if (h.endsWith("kick.com")) {
      live = parts.length === 1 && !["video", "videos"].includes(parts[0]);
    } else if (h.endsWith("twitch.tv")) {
      live = parts.length === 1 && !["videos", "directory", "settings"].includes(parts[0]);
    } else if (h.endsWith("youtube.com") || h === "youtu.be") {
      const player = document.querySelector(".html5-video-player");
      const badge = document.querySelector(".ytp-live-badge");
      const badgeVisible = badge && badge.offsetParent !== null && getComputedStyle(badge).display !== "none";
      live = !!(player && player.classList.contains("ytp-live")) || !!badgeVisible ||
        (!!video && video.duration === Infinity);
    }
    if (live) kind = "En vivo";
    return { live, kind, currentTime };
  }

  function close() {
    if (host) host.remove();
    host = null;
    window.removeEventListener("keydown", onKey, true);
  }

  function toast(text, ok = true) {
    const t = document.createElement("div");
    t.textContent = text;
    t.style.cssText = `position:fixed;z-index:2147483647;right:20px;bottom:24px;padding:12px 16px;border-radius:12px;
      font:600 14px system-ui,sans-serif;color:#fff;background:${ok ? "#16a34a" : "#dc2626"};box-shadow:0 8px 30px #0008;`;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function choose(seconds) {
    if (!state) return;
    const { requestedAt, ctx } = state;
    close();
    chrome.runtime.sendMessage(
      {
        type: "snip-clip",
        duration_s: seconds,
        requestedAt,
        live: ctx.live,
        currentTime: ctx.currentTime,
        pageUrl: location.href
      },
      (res) => {
        if (chrome.runtime.lastError) return toast("Snip: " + chrome.runtime.lastError.message, false);
        if (res && res.ok) toast("✂️ " + res.message);
        else toast("Snip: " + ((res && res.message) || "error desconocido"), false);
      }
    );
  }

  function onKey(e) {
    if (!host) return;
    const inCustom = e.target === host; // el input del shadow DOM se retargetea al host
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return close(); }
    if (inCustom && host.__customActive) {
      if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        const v = parseFloat(host.shadowRoot.querySelector("input").value);
        if (v > 0 && v <= 600) choose(v);
      }
      e.stopPropagation();
      return;
    }
    if (/^[1-6]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); return choose(DURATIONS[+e.key - 1]); }
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); return choose(30); }
  }

  function open(requestedAt) {
    close();
    state = { requestedAt, ctx: detectContext() };
    host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:20px;bottom:24px;";
    const root = host.attachShadow({ mode: "open" });
    const ctx = state.ctx;
    const where = ctx.live ? "Directo: se corta del búfer" : `VOD en ${Math.floor(ctx.currentTime)} s`;
    root.innerHTML = `
      <style>
        .p{font:14px system-ui,sans-serif;color:#e4e4e7;background:#14171f;border:1px solid #ffffff22;border-radius:14px;
           padding:14px;box-shadow:0 12px 40px #000a;width:300px}
        h1{font-size:14px;margin:0 0 2px;font-weight:700}
        small{color:#a1a1aa;display:block;margin-bottom:10px}
        .c{display:flex;flex-wrap:wrap;gap:6px}
        button{all:unset;cursor:pointer;padding:8px 12px;border-radius:9px;background:#ffffff14;font-weight:600;font-size:13px}
        button:hover{background:#7c5cff}
        kbd{opacity:.55;margin-right:5px;font-size:11px}
        .x{display:none;margin-top:8px;gap:6px}
        input{all:unset;background:#0b0d12;border:1px solid #ffffff33;border-radius:8px;padding:6px 8px;width:70px;color:#fff}
        .f{margin-top:10px;color:#71717a;font-size:11px}
      </style>
      <div class="p">
        <h1>Snip · ¿cuánto clip?</h1>
        <small>${ctx.kind} · ${where}</small>
        <div class="c">
          ${DURATIONS.map((d, i) => `<button data-s="${d}"><kbd>${i + 1}</kbd>${d} s</button>`).join("")}
          <button data-s="custom">Personalizado</button>
        </div>
        <div class="x"><input type="number" min="1" max="600" value="20" placeholder="s"><button data-s="go">Crear</button></div>
        <div class="f">Enter = 30 s · Esc cierra</div>
      </div>`;
    root.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        const s = b.dataset.s;
        if (s === "custom") {
          root.querySelector(".x").style.display = "flex";
          host.__customActive = true;
          root.querySelector("input").focus();
        } else if (s === "go") {
          const v = parseFloat(root.querySelector("input").value);
          if (v > 0 && v <= 600) choose(v);
        } else choose(+s);
      })
    );
    document.documentElement.appendChild(host);
    window.addEventListener("keydown", onKey, true);
  }

  window.__snipOpen = open;
})();
