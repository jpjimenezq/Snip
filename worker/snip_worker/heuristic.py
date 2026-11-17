"""Selector de momentos SIN IA (modo local sin ANTHROPIC_API_KEY).

Puntúa ventanas deslizantes por (a) picos de volumen y (b) densidad de habla, y elige
las mejores sin solaparse. Es una aproximación muy simple: no entiende el contenido."""
from __future__ import annotations

from typing import Sequence

from .render.zoom import WIN_S, loudness_db
from .transcript_utils import all_words, text_in_range

DEFAULT_CLIP_S = 30.0
STEP_S = 5.0
MAX_SILENCE_S = 3.0


def loudness_curve(src: str, start: float, end: float, chunk_s: float = 600.0) -> list[float]:
    """Curva de volumen (dB por ventana de 0.1 s) de [start, end], leída por trozos
    para no cargar horas de audio en memoria."""
    out: list[float] = []
    t = start
    while t < end:
        d = min(chunk_s, end - t)
        out.extend(loudness_db(src, t, d))
        t += d
    return out


def _words_per_second(words: list[dict], a: float, b: float) -> float:
    n = sum(1 for w in words if a <= (float(w["start"]) + float(w["end"])) / 2 < b)
    return n / max(b - a, 1e-6)


def _peak_score(db: Sequence[float], origin: float, a: float, b: float, floor: float) -> float:
    """Media de los 5 niveles más altos (en dB sobre el piso) dentro de la ventana."""
    i0 = max(0, int((a - origin) / WIN_S))
    i1 = min(len(db), int((b - origin) / WIN_S))
    seg = sorted(db[i0:i1], reverse=True)[:5]
    if not seg:
        return 0.0
    return max(0.0, sum(seg) / len(seg) - floor)


def pick_moments(segments: list[dict], db: Sequence[float], range_start: float, range_end: float,
                 max_clips: int = 3, clip_s: float = DEFAULT_CLIP_S) -> list[dict]:
    """Devuelve hasta max_clips dicts {start_s,end_s,title,hook,reason,score} (score 0-100).

    `db` es la curva de volumen que empieza en `range_start`."""
    words = all_words(segments)
    if range_end - range_start < 5 or not words:
        return []
    clip_s = min(clip_s, range_end - range_start)
    ordered = sorted(db)
    floor = ordered[len(ordered) // 2] if ordered else -60.0  # mediana = ruido de fondo / habla normal
    cands = []
    t = range_start
    while t + clip_s <= range_end + 1e-6:
        a, b = t, t + clip_s
        wps = _words_per_second(words, a, b)
        peak = _peak_score(db, range_start, a, b, floor)
        cands.append((a, b, wps, peak))
        t += STEP_S
    if not cands:
        return []
    max_wps = max(c[2] for c in cands) or 1.0
    max_peak = max(c[3] for c in cands) or 1.0
    scored = []
    for a, b, wps, peak in cands:
        if wps < 0.5:  # casi sin habla: no es un clip
            continue
        sc = 0.55 * (peak / max_peak) + 0.45 * (wps / max_wps)
        scored.append((sc, a, b, wps, peak))
    scored.sort(reverse=True)
    picked: list[tuple] = []
    for item in scored:
        if all(item[2] <= p[1] or item[1] >= p[2] for p in picked):
            picked.append(item)
        if len(picked) >= max_clips:
            break
    seg_starts = [float(x["start"]) for x in segments]
    seg_ends = [float(x["end"]) for x in segments]
    out = []
    for sc, a, b, wps, peak in sorted(picked, key=lambda x: x[1]):
        # empezar/terminar en límites de frase (segmento de Whisper) cercanos, no a mitad de frase
        a = min((x for x in seg_starts if abs(x - a) <= 5.0), key=lambda x: abs(x - a), default=a)
        b = min((x for x in seg_ends if abs(x - b) <= 5.0), key=lambda x: abs(x - b), default=b)
        text = text_in_range(segments, a, b)
        toks = text.split()
        title = " ".join(toks[:8]) + ("…" if len(toks) > 8 else "")
        out.append({
            "start_s": round(a, 3), "end_s": round(b, 3),
            "title": title[:80] or "Clip sin IA",
            "hook": " ".join(toks[:12]),
            "reason": f"sin IA: {wps:.1f} palabras/s y picos de volumen {peak:.0f} dB sobre el nivel medio",
            "score": int(round(sc * 100)),
        })
    return out
