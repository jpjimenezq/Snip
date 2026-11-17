"""Generación de copies por red social con Claude (salidas estructuradas)."""
from __future__ import annotations

import logging

import anthropic
from pydantic import BaseModel

from .analyze import extract_parsed, parse_structured
from .config import get_settings

log = logging.getLogger("snip.copies")

COPY_SYSTEM_PROMPT = """Eres un community manager experto en clips de streamers latinoamericanos (Kick, Twitch, YouTube) para TikTok, Instagram Reels, YouTube Shorts y Facebook. Escribes en español natural, con tono colombiano / latino cercano y fresco (sin exagerar la jerga ni sonar forzado), como lo haría alguien que vive la cultura del stream.

Recibirás el título del clip, el canal/streamer y la transcripción del clip. Genera textos listos para publicar:
- YouTube Shorts: título (máx. 100 caracteres, gancho claro, puedes incluir #Shorts al final), descripción (2-4 líneas con contexto, crédito al canal y llamada a suscribirse) y 5-10 tags sin '#'.
- TikTok: caption corta (máx. 150 caracteres, con gancho) y 3-6 hashtags (con '#').
- Instagram: caption algo más larga (hasta ~300 caracteres, puede tener saltos de línea y emojis moderados) y 5-10 hashtags (con '#').
- Facebook: caption breve y conversacional que invite a comentar.

Reglas: da crédito al streamer/canal (menciónalo por su nombre en la descripción y/o caption); no inventes hechos que no estén en la transcripción; hashtags relevantes (streamer, plataforma, temática, #fyp / #viral solo si encajan); no repitas el mismo texto en todas las redes."""


class YoutubeCopy(BaseModel):
    title: str
    description: str
    tags: list[str]


class CaptionCopy(BaseModel):
    caption: str
    hashtags: list[str]


class FacebookCopy(BaseModel):
    caption: str


class Copies(BaseModel):
    youtube: YoutubeCopy
    tiktok: CaptionCopy
    instagram: CaptionCopy
    facebook: FacebookCopy


def normalize_copies(c: Copies) -> dict:
    """Convierte al contrato clips.copies: hashtags con '#', tags de YouTube sin '#'."""

    def tag(h: str) -> str:
        h = h.strip().lstrip("#").replace(" ", "")
        return f"#{h}" if h else ""

    def hashtags(items: list[str]) -> list[str]:
        out, seen = [], set()
        for h in items:
            t = tag(h)
            if t and t.lower() not in seen:
                seen.add(t.lower())
                out.append(t)
        return out

    return {
        "youtube": {
            "title": c.youtube.title.strip(),
            "description": c.youtube.description.strip(),
            "tags": [t.strip().lstrip("#") for t in c.youtube.tags if t.strip().lstrip("#")],
        },
        "tiktok": {"caption": c.tiktok.caption.strip(), "hashtags": hashtags(c.tiktok.hashtags)},
        "instagram": {
            "caption": c.instagram.caption.strip(),
            "hashtags": hashtags(c.instagram.hashtags),
        },
        "facebook": {"caption": c.facebook.caption.strip()},
    }


def generate_copies(
    clip_text: str,
    title: str | None,
    channel: str | None,
    client: anthropic.Anthropic | None = None,
) -> dict:
    s = get_settings()
    if client is None:
        s.require_anthropic()
        client = anthropic.Anthropic(api_key=s.anthropic_api_key)
    user = (
        f"Canal / streamer: {channel or 'desconocido'}\n"
        f"Título del clip: {title or '(sin título)'}\n\n"
        f"Transcripción del clip:\n{clip_text.strip() or '(sin texto)'}"
    )
    # Haiku 5.5 no tiene fallback del lado del servidor: no se envía `fallbacks`.
    resp = parse_structured(
        client,
        model=s.copy_model,
        system=COPY_SYSTEM_PROMPT,
        user=user,
        output_format=Copies,
        max_tokens=4000,
        effort="low",
        server_fallback=False,
    )
    return normalize_copies(extract_parsed(resp, "copies"))
