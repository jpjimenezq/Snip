"""Piezas compartidas por los publicadores de cada red (fase 4)."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import httpx

log = logging.getLogger("snip.publish")

# Versión de Graph API (Instagram + Facebook). Cambiarla aquí basta.
GRAPH_VERSION = "v23.0"
GRAPH = f"https://graph.facebook.com/{GRAPH_VERSION}"

# Los scripts de prueba reemplazan esto para no esperar de verdad.
def sleep(seconds: float) -> None:
    time.sleep(seconds)


class PublishError(Exception):
    """Fallo de publicación con mensaje legible (español) para mostrar en la web."""


class AuthExpired(PublishError):
    """El token ya no sirve: hay que reconectar la cuenta."""


@dataclass
class PublishResult:
    external_id: str | None = None
    external_url: str | None = None
    note: str | None = None  # p. ej. "Enviado a tu bandeja de TikTok..."


@dataclass
class PublishContext:
    http: httpx.Client
    pub: dict
    clip: dict
    account: dict
    tokens: dict  # access_token, refresh_token, expires_at, extra
    video_path: Path
    duration_s: float
    progress: Callable[[float], None] = lambda v: None
    set_status: Callable[[str], None] = lambda s: None
    signed_url: Callable[[], str] = lambda: ""
    extra: dict = field(default_factory=dict)

    @property
    def access_token(self) -> str:
        return self.tokens.get("access_token") or ""

    @property
    def token_extra(self) -> dict:
        return self.tokens.get("extra") or {}

    @property
    def caption(self) -> str:
        return (self.pub.get("caption") or self.pub.get("title") or "").strip()

    @property
    def file_size(self) -> int:
        return self.video_path.stat().st_size


def _error_message(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except Exception:
        return (resp.text or "")[:300]
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            msg = str(err.get("message") or err.get("code") or err)
            reasons = [str(e.get("reason")) for e in err.get("errors") or [] if isinstance(e, dict) and e.get("reason")]
            if reasons:
                msg += " [" + ", ".join(reasons) + "]"
            return msg[:300]
        if isinstance(err, str):
            return (err + " " + str(body.get("error_description") or ""))[:300]
    return str(body)[:300]


def request(
    http: httpx.Client,
    method: str,
    url: str,
    *,
    ok: tuple[int, ...] = (200, 201),
    retries: int = 2,
    what: str = "la API",
    **kwargs: Any,
) -> httpx.Response:
    """Llamada HTTP con reintentos en 429/5xx y errores legibles."""
    last: httpx.Response | None = None
    for attempt in range(retries + 1):
        try:
            resp = http.request(method, url, **kwargs)
        except httpx.TransportError as exc:
            if attempt >= retries:
                raise PublishError(f"Error de red hablando con {what}: {exc}") from exc
            sleep(2 * (attempt + 1))
            continue
        if resp.status_code in ok:
            return resp
        last = resp
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < retries:
            sleep(2 * (attempt + 1))
            continue
        break
    assert last is not None
    if last.status_code == 401:
        raise AuthExpired(f"{what} rechazó el token (401). Reconecta la cuenta.")
    raise PublishError(f"{what} respondió {last.status_code}: {_error_message(last)}")


def read_chunks(path: Path, start: int, length: int, step: int = 1024 * 1024):
    """Genera el rango [start, start+length) del archivo en trozos pequeños."""
    with open(path, "rb") as f:
        f.seek(start)
        left = length
        while left > 0:
            data = f.read(min(step, left))
            if not data:
                break
            left -= len(data)
            yield data


def read_range(path: Path, start: int, length: int) -> bytes:
    with open(path, "rb") as f:
        f.seek(start)
        return f.read(length)


def clamp(text: str, limit: int) -> str:
    text = text or ""
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
