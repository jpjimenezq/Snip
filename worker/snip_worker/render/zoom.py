"""Punch-in zooms: timeline sanitising/merging, audio-peak detection and ffmpeg expressions."""
from __future__ import annotations

import logging
import subprocess
from typing import Sequence

from .errors import RenderError

log = logging.getLogger("snip.render.zoom")

EASE_S = 0.25               # ease in / out duration
MIN_ZOOM_S = 0.4
MIN_SCALE, MAX_SCALE = 1.05, 2.0

AUTO_SCALE = 1.25
AUTO_MIN_GAP_S = 7.0        # ~1 zoom every 6-8 s at most
AUTO_MIN_DUR_S = 1.2
AUTO_MAX_DUR_S = 2.0
AUTO_LEAD_S = 0.15          # zoom starts slightly before the peak
AUTO_MIN_ABOVE_MEDIAN_DB = 6.0
AUTO_FLOOR_DB = -45.0
AUDIO_RATE = 16000
WIN_S = 0.1


def sanitize_zooms(zooms, duration: float) -> list[dict]:
    """Validate raw layout zooms -> sorted, clamped, non-overlapping [{start,end,scale}]."""
    items = []
    for z in zooms if isinstance(zooms, list) else []:
        if not isinstance(z, dict):
            continue
        try:
            s, e, sc = float(z.get("start")), float(z.get("end")), float(z.get("scale", 1.3))
        except (TypeError, ValueError):
            continue
        if not (s == s and e == e and sc == sc):
            continue
        s, e = max(0.0, s), min(duration, e)
        sc = min(max(sc, MIN_SCALE), MAX_SCALE)
        if e - s >= MIN_ZOOM_S:
            items.append({"start": s, "end": e, "scale": sc})
    items.sort(key=lambda z: z["start"])
    out: list[dict] = []
    for z in items:
        if out and z["start"] < out[-1]["end"]:
            z = {**z, "start": out[-1]["end"]}
            if z["end"] - z["start"] < MIN_ZOOM_S:
                continue
        out.append(z)
    return out


def merge_zooms(manual, auto: Sequence[dict], duration: float) -> list[dict]:
    """Manual zooms win; auto zooms that overlap a manual one (with a small margin) are dropped."""
    man = sanitize_zooms(manual, duration)
    kept = []
    for a in sanitize_zooms(list(auto), duration):
        if all(a["end"] + 0.5 <= m["start"] or a["start"] >= m["end"] + 0.5 for m in man):
            kept.append(a)
    return sanitize_zooms(man + kept, duration)


def pick_zoom_moments(db: Sequence[float], win_s: float = WIN_S, duration: float | None = None,
                      scale: float = AUTO_SCALE, min_gap: float = AUTO_MIN_GAP_S) -> list[dict]:
    """Choose zoom moments from a loudness curve (dB per `win_s` window).

    Greedy on the strongest peaks, keeping `min_gap` seconds between zoom starts and requiring
    the peak to clearly stand out from the clip's median level."""
    n = len(db)
    if n < 5:
        return []
    k = max(1, int(round(0.5 / win_s)))
    sm = []  # moving average (0.5 s) of the dB curve
    for i in range(n):
        lo, hi = max(0, i - k // 2), min(n, i + k // 2 + 1)
        sm.append(sum(db[lo:hi]) / (hi - lo))
    ordered = sorted(sm)
    median = ordered[n // 2]
    thresh = max(median + AUTO_MIN_ABOVE_MEDIAN_DB, AUTO_FLOOR_DB)
    total = duration if duration is not None else n * win_s
    cand = sorted((i for i in range(n)
                   if sm[i] >= thresh and sm[i] == max(sm[max(0, i - k):i + k + 1])),
                  key=lambda i: -sm[i])
    picked: list[dict] = []
    for i in cand:
        t = i * win_s
        start = max(0.0, t - AUTO_LEAD_S)
        if any(abs(start - p["start"]) < min_gap for p in picked):
            continue
        # duration: how long the loud stretch lasts (within 3 dB of the peak), clamped
        j = i
        while j < n - 1 and sm[j + 1] >= sm[i] - 3.0 and (j - i) * win_s < AUTO_MAX_DUR_S:
            j += 1
        dur = min(max((j - i) * win_s + 0.8, AUTO_MIN_DUR_S), AUTO_MAX_DUR_S)
        end = min(total, start + dur)
        if end - start < MIN_ZOOM_S:
            continue
        picked.append({"start": round(start, 2), "end": round(end, 2), "scale": scale})
    picked.sort(key=lambda z: z["start"])
    return picked


def loudness_db(src: str, start: float, duration: float) -> list[float]:
    """dBFS RMS per WIN_S window of the clip's audio (empty if there is no audio)."""
    import numpy as np
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error",
           "-ss", f"{start:.3f}", "-i", src, "-t", f"{duration:.3f}", "-vn", "-map", "0:a:0",
           "-ac", "1", "-ar", str(AUDIO_RATE), "-f", "f32le", "pipe:1"]
    try:
        r = subprocess.run(cmd, capture_output=True, stdin=subprocess.DEVNULL, timeout=300)
    except FileNotFoundError as e:
        raise RenderError("ffmpeg not found on PATH") from e
    if r.returncode != 0 or len(r.stdout) < 4:
        return []
    x = np.frombuffer(r.stdout[: len(r.stdout) // 4 * 4], dtype="<f4")
    w = int(AUDIO_RATE * WIN_S)
    n = len(x) // w
    if n == 0:
        return []
    rms = np.sqrt(np.mean(x[: n * w].reshape(n, w) ** 2, axis=1))
    return (20.0 * np.log10(np.maximum(rms, 1e-6))).tolist()


def auto_zooms(src: str, start: float, duration: float) -> list[dict]:
    try:
        return pick_zoom_moments(loudness_db(src, start, duration), duration=duration)
    except Exception as e:  # noqa: BLE001
        log.warning("auto_zoom failed: %s", e)
        return []


def _f(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return s or "0"


def zoom_expr(zooms: Sequence[dict], var: str = "t") -> str:
    """ffmpeg expression for the zoom factor z(t) (>= 1) with smoothstep ease in/out.

    Uses st/ld registers: 0 = current bump progress, 1 = accumulated factor."""
    parts = ["st(1,1)"]
    for z in zooms:
        a, b, s = z["start"], z["end"], z["scale"]
        e = min(EASE_S, (b - a) / 2.0)
        parts.append(f"st(0,min(clip(({var}-{_f(a)})/{_f(e)},0,1),clip(({_f(b)}-{var})/{_f(e)},0,1)))")
        parts.append(f"st(1,ld(1)+{_f(s - 1)}*ld(0)*ld(0)*(3-2*ld(0)))")
    parts.append("ld(1)")
    return ";".join(parts)


def zoom_filter(zooms: Sequence[dict], out_w: int, out_h: int,
                center: tuple[float, float] = (0.5, 0.5)) -> str:
    """scale(eval=frame)+crop chain that punches in around `center` (fractions of the frame),
    always outputting out_w x out_h."""
    z = zoom_expr(zooms)
    fx, fy = center
    return (f"scale=w='trunc({out_w}*({z})/2)*2':h='trunc({out_h}*({z})/2)*2':eval=frame:flags=bicubic,"
            f"crop={out_w}:{out_h}:x='{_f(fx)}*(iw-{out_w})':y='{_f(fy)}*(ih-{out_h})',setsar=1")
