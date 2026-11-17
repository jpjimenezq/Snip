"""Cálculos puros de rangos de clips."""
from __future__ import annotations

from .transcript_utils import fmt_ts, text_in_range


def manual_range(at_s: float, duration_s: float, source_duration: float | None = None) -> tuple[float, float]:
    """Clip manual: termina en at_s y empieza duration_s antes (mínimo 0)."""
    at_s = max(0.0, float(at_s))
    duration_s = max(1.0, float(duration_s))
    if source_duration:
        at_s = min(at_s, float(source_duration))
    start = max(0.0, at_s - duration_s)
    end = at_s
    if end - start < 1.0:  # at_s ~ 0 o fuera de rango: usar el primer tramo del video
        start = 0.0
        end = min(duration_s, float(source_duration)) if source_duration else duration_s
        if end - start < 1.0:
            end = start + 1.0
    return round(start, 3), round(end, 3)


def manual_title(segments: list[dict], start: float, end: float, max_words: int = 8) -> str:
    text = text_in_range(segments, start, end)
    words = text.split()
    if not words:
        return f"Clip manual {fmt_ts(start)}"
    title = " ".join(words[:max_words])
    if len(words) > max_words:
        title += "…"
    return title[:80]
