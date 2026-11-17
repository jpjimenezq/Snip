"""Utilidades puras sobre transcripciones (sin red ni GPU, fáciles de probar)."""
from __future__ import annotations

from typing import Iterable


def fmt_ts(seconds: float) -> str:
    s = max(0, int(seconds))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def all_words(segments: list[dict]) -> list[dict]:
    """Lista plana de palabras [{start,end,word}]. Si un segmento no trae palabras,
    se reparte su texto uniformemente en su rango."""
    out: list[dict] = []
    for seg in segments:
        words = seg.get("words") or []
        if words:
            out.extend(words)
            continue
        toks = (seg.get("text") or "").split()
        if not toks:
            continue
        s, e = float(seg["start"]), float(seg["end"])
        step = (e - s) / len(toks)
        for i, t in enumerate(toks):
            out.append({"start": s + i * step, "end": s + (i + 1) * step, "word": t})
    return out


def words_in_range(segments: list[dict], start: float, end: float) -> list[dict]:
    """Palabras cuyo punto medio cae dentro de [start, end] (segundos absolutos)."""
    res = []
    for w in all_words(segments):
        mid = (float(w["start"]) + float(w["end"])) / 2
        if start <= mid <= end:
            res.append(
                {"start": float(w["start"]), "end": float(w["end"]), "word": str(w["word"]).strip()}
            )
    return res


def text_in_range(segments: list[dict], start: float, end: float) -> str:
    return " ".join(w["word"] for w in words_in_range(segments, start, end) if w["word"]).strip()


def build_lines(segments: list[dict], min_s: float = 5.0, max_s: float = 10.0, gap_s: float = 2.0) -> list[tuple[float, str]]:
    """Agrupa palabras en líneas de ~5-10 s. Devuelve [(inicio, texto)]."""
    lines: list[tuple[float, str]] = []
    cur: list[str] = []
    cur_start = 0.0
    last_end = 0.0
    for w in all_words(segments):
        ws, we = float(w["start"]), float(w["end"])
        token = str(w["word"]).strip()
        if not token:
            continue
        if cur:
            span = we - cur_start
            gap = ws - last_end
            sentence_end = cur[-1][-1] in ".?!…"
            if span > max_s or gap > gap_s or (span >= min_s and sentence_end):
                lines.append((cur_start, " ".join(cur)))
                cur = []
        if not cur:
            cur_start = ws
        cur.append(token)
        last_end = we
    if cur:
        lines.append((cur_start, " ".join(cur)))
    return lines


def format_lines(lines: Iterable[tuple[float, str]]) -> list[str]:
    return [f"[{fmt_ts(t)}] {txt}" for t, txt in lines]


def estimate_tokens(text: str) -> int:
    # Español: ~3.2 caracteres por token como estimación conservadora.
    return int(len(text) / 3.2) + 1


def chunk_lines(
    lines: list[tuple[float, str]], max_tokens: int = 250_000, overlap_s: float = 300.0
) -> list[list[tuple[float, str]]]:
    """Parte las líneas en trozos de <= max_tokens con solape temporal."""
    if sum(estimate_tokens(t) + 12 for _, t in lines) <= max_tokens:
        return [lines]
    chunks: list[list[tuple[float, str]]] = []
    i = 0
    n = len(lines)
    while i < n:
        toks = 0
        j = i
        while j < n and toks + estimate_tokens(lines[j][1]) + 12 <= max_tokens:
            toks += estimate_tokens(lines[j][1]) + 12
            j += 1
        if j == i:
            j = i + 1
        chunks.append(lines[i:j])
        if j >= n:
            break
        # retroceder para solapar
        k = j
        while k > i + 1 and lines[j][0] - lines[k - 1][0] < overlap_s:
            k -= 1
        i = k if k > i else j
    return chunks
