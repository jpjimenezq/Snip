"""Detección de momentos con Claude (salidas estructuradas con Pydantic)."""
from __future__ import annotations

import logging
from typing import Callable

import anthropic
from pydantic import BaseModel

from .config import get_settings
from .transcript_utils import all_words, build_lines, chunk_lines, format_lines

log = logging.getLogger("snip.analyze")

MIN_CLIP_S = 15.0
MAX_CLIP_S = 90.0
SNAP_WINDOW_S = 2.5
SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01"
ANALYSIS_MAX_TOKENS = 16000

SYSTEM_PROMPT = """Eres un editor experto de contenido corto (TikTok, Instagram Reels, YouTube Shorts) especializado en la cultura de streaming de Latinoamérica: streamers de Kick y Twitch como Westcol y su comunidad, humor colombiano y latino, jerga como "parce", "qué boleta", "mamar gallo", "¡qué nota!", "chimba", "bacano", "gonorrea" (como exclamación), "hijueputa", "de una", "no joda", etc. Entiendes el contexto de los directos: donaciones, reacciones al chat, retos, peleas amistosas, polémicas, historias personales y momentos virales.

Recibirás la transcripción de un directo o video, como líneas con marca de tiempo `[HH:MM:SS] texto`. La transcripción es automática: puede tener errores de ortografía o nombres mal escritos; interpreta con criterio.

Tu trabajo: encontrar entre 5 y 15 momentos (menos si el material es corto o flojo; nunca rellenes con momentos mediocres) que funcionen SOLOS como clip vertical. Busca:
- Un gancho fuerte en los primeros 3 segundos (una frase impactante, una pregunta, un grito, una afirmación provocadora).
- Picos emocionales: rabia, euforia, sorpresa, vergüenza, llanto.
- Momentos graciosos, chistes con remate (punchline), burlas, situaciones absurdas.
- Opiniones polémicas o "hot takes" que generen debate.
- Reacciones intensas a algo que pasa.
- Historias o anécdotas con desenlace claro (planteamiento, giro y remate).

Evita:
- Momentos que requieran mucho contexto previo para entenderse.
- Charla de relleno, saludos, lecturas de chat sin gracia, silencios, problemas técnicos.
- Clips que empiecen a mitad de frase o terminen cortados antes del remate.

Reglas de cada momento:
- start_s y end_s son segundos desde el inicio del video (usa las marcas de tiempo; puedes interpolar dentro de una línea). Comienza justo donde arranca el gancho y termina justo después del remate o la reacción final.
- Duración entre 15 y 90 segundos; prefiere 20 a 60.
- Los momentos NO deben solaparse entre sí.
- title: título corto y llamativo en español (máx. 70 caracteres), sin clickbait falso.
- hook: la frase o idea que engancha en los primeros segundos (puede ser una cita textual breve).
- reason: una o dos frases explicando por qué funciona como clip.
- score: entero de 0 a 100 con el potencial viral real (sé exigente: 90+ solo para momentos excepcionales).

Responde únicamente con el objeto estructurado solicitado."""


class Moment(BaseModel):
    start_s: float
    end_s: float
    title: str
    hook: str
    reason: str
    score: int


class MomentList(BaseModel):
    moments: list[Moment]


class AnalysisRefused(RuntimeError):
    pass


# ---------------- post-procesado (puro) ----------------
def _nearest(value: float, candidates: list[float], window: float) -> float:
    best = value
    best_d = window + 1e-9
    for c in candidates:
        d = abs(c - value)
        if d < best_d:
            best, best_d = c, d
    return best


def snap_moments(
    moments: list[Moment | dict], segments: list[dict], duration: float | None
) -> list[dict]:
    """Ajusta inicio/fin a límites de palabra/segmento, limita a la duración, impone 15-90 s
    y elimina solapes (se queda el de mayor score). Devuelve dicts ordenados por inicio."""
    words = all_words(segments)
    starts = [float(w["start"]) for w in words] + [float(s["start"]) for s in segments]
    ends = [float(w["end"]) for w in words] + [float(s["end"]) for s in segments]
    if duration is None or duration <= 0:
        duration = max(ends) if ends else None

    cleaned: list[dict] = []
    for m in moments:
        d = m.model_dump() if isinstance(m, Moment) else dict(m)
        try:
            s, e = float(d["start_s"]), float(d["end_s"])
        except (KeyError, TypeError, ValueError):
            continue
        if e < s:
            s, e = e, s
        if starts:
            s = _nearest(s, starts, SNAP_WINDOW_S)
        if ends:
            e = _nearest(e, ends, SNAP_WINDOW_S)
        if duration is not None:
            s = max(0.0, min(s, duration))
            e = max(0.0, min(e, duration))
        else:
            s = max(0.0, s)
        if e - s > MAX_CLIP_S:
            e = s + MAX_CLIP_S
            if ends:
                # recortar al final de palabra más cercano por debajo del máximo
                cands = [x for x in ends if s + MIN_CLIP_S <= x <= s + MAX_CLIP_S]
                if cands:
                    e = max(cands)
        if e - s < MIN_CLIP_S:
            target = s + MIN_CLIP_S
            if duration is not None and target > duration:
                s = max(0.0, duration - MIN_CLIP_S)
                target = min(duration, s + MIN_CLIP_S)
            e = target
        if duration is not None:
            e = min(e, duration)
        if e - s < 3.0:  # demasiado corto incluso tras ajustar (video minúsculo)
            continue
        score = int(max(0, min(100, round(float(d.get("score", 0) or 0)))))
        cleaned.append(
            {
                "start_s": round(s, 3),
                "end_s": round(e, 3),
                "title": str(d.get("title") or "").strip()[:120],
                "hook": str(d.get("hook") or "").strip(),
                "reason": str(d.get("reason") or "").strip(),
                "score": score,
            }
        )
    return remove_overlaps(cleaned)


def remove_overlaps(moments: list[dict], tolerance: float = 1.0) -> list[dict]:
    kept: list[dict] = []
    for m in sorted(moments, key=lambda x: (-x["score"], x["start_s"])):
        if all(
            min(m["end_s"], k["end_s"]) - max(m["start_s"], k["start_s"]) <= tolerance
            for k in kept
        ):
            kept.append(m)
    return sorted(kept, key=lambda x: x["start_s"])


# ---------------- llamada a Claude ----------------
def _client() -> anthropic.Anthropic:
    s = get_settings()
    s.require_anthropic()
    return anthropic.Anthropic(api_key=s.anthropic_api_key)


def parse_structured(
    client: anthropic.Anthropic,
    *,
    model: str,
    system: str,
    user: str,
    output_format: type[BaseModel],
    max_tokens: int,
    effort: str | None = None,
    server_fallback: bool = False,
):
    """Llama a messages.parse con salida estructurada. Con server_fallback usa la beta de
    fallbacks del lado del servidor (solo modelos que lo soportan; Haiku 5.5 NO)."""
    kwargs: dict = dict(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_format=output_format,
    )
    if effort:
        kwargs["output_config"] = {"effort": effort}
    if server_fallback:
        resp = client.beta.messages.parse(
            betas=[SERVER_FALLBACK_BETA], fallbacks="default", **kwargs
        )
    else:
        resp = client.messages.parse(**kwargs)
    return resp


def extract_parsed(resp, what: str):
    """Devuelve parsed_output o lanza un error claro (refusal / max_tokens / vacío)."""
    stop = getattr(resp, "stop_reason", None)
    if stop == "refusal":
        details = getattr(resp, "stop_details", None)
        cat = getattr(details, "category", None)
        expl = getattr(details, "explanation", None)
        raise AnalysisRefused(
            f"Claude rechazó la solicitud de {what} (categoría: {cat}). {expl or ''}".strip()
        )
    if stop == "max_tokens":
        raise RuntimeError(f"La respuesta de {what} se cortó por max_tokens")
    parsed = getattr(resp, "parsed_output", None)
    if parsed is None:
        raise RuntimeError(f"Claude no devolvió una salida estructurada válida para {what}")
    return parsed


def _find_chunk_moments(client, chunk: list[tuple[float, str]], total_duration: float | None) -> list[Moment]:
    s = get_settings()
    header = ""
    if total_duration:
        header = f"Duración total del video: {total_duration:.0f} segundos.\n"
    header += (
        f"Esta parte de la transcripción va de {chunk[0][0]:.0f} s a {chunk[-1][0]:.0f} s.\n\n"
        "Transcripción:\n"
    )
    user = header + "\n".join(format_lines(chunk))
    resp = parse_structured(
        client,
        model=s.analysis_model,
        system=SYSTEM_PROMPT,
        user=user,
        output_format=MomentList,
        max_tokens=ANALYSIS_MAX_TOKENS,
        server_fallback=True,
    )
    return extract_parsed(resp, "análisis de momentos").moments


def find_moments(
    segments: list[dict],
    duration: float | None,
    on_progress: Callable[[float], None] | None = None,
    client: anthropic.Anthropic | None = None,
) -> list[dict]:
    lines = build_lines(segments)
    if not lines:
        return []
    client = client or _client()
    chunks = chunk_lines(lines)
    log.info("Analizando %d líneas de transcripción en %d llamada(s) a Claude", len(lines), len(chunks))
    raw: list[Moment] = []
    for i, chunk in enumerate(chunks):
        raw.extend(_find_chunk_moments(client, chunk, duration))
        if on_progress:
            on_progress((i + 1) / len(chunks))
    return snap_moments(raw, segments, duration)
