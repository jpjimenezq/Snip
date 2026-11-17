"""YouTube Data API v3: subida reanudable (videos.insert, uploadType=resumable).

Referencia: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
Sin verificar contra la API real (escrito desde la documentación).
"""
from __future__ import annotations

import json
import os
import re

import httpx

from . import common
from .common import AuthExpired, PublishContext, PublishError, PublishResult

TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
CHUNK = 8 * 1024 * 1024  # múltiplo de 256 KiB, requisito del protocolo


def refresh(http: httpx.Client, tokens: dict) -> dict:
    """Canjea el refresh_token. Devuelve {access_token, expires_in}."""
    cid, secret = os.environ.get("GOOGLE_CLIENT_ID", ""), os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not cid or not secret:
        raise PublishError("Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en worker/.env para renovar el token de YouTube.")
    if not tokens.get("refresh_token"):
        raise AuthExpired("La cuenta de YouTube no tiene refresh_token. Reconéctala.")
    resp = http.post(TOKEN_URL, data={
        "client_id": cid, "client_secret": secret,
        "refresh_token": tokens["refresh_token"], "grant_type": "refresh_token",
    })
    if resp.status_code != 200:
        msg = common._error_message(resp)
        if resp.status_code in (400, 401):  # invalid_grant: revocado o caducado (modo pruebas: 7 días)
            raise AuthExpired(f"Google rechazó la renovación ({msg}). Reconecta la cuenta de YouTube.")
        raise PublishError(f"No se pudo renovar el token de YouTube ({resp.status_code}): {msg}")
    return resp.json()


def build_title(ctx: PublishContext) -> str:
    title = (ctx.pub.get("title") or ctx.clip.get("title") or "Clip").strip()
    title = re.sub(r"[<>]", "", title)
    short = ctx.duration_s <= 60
    desc = ctx.pub.get("caption") or ""
    if short and "#shorts" not in (title + " " + desc).lower():
        title = common.clamp(title, 92) + " #shorts"
    return common.clamp(title, 100)


def build_tags(ctx: PublishContext) -> list[str]:
    raw = ((ctx.clip.get("copies") or {}).get("youtube") or {}).get("tags") or []
    tags, total = [], 0
    for t in raw:
        t = str(t).strip().lstrip("#")
        if not t or total + len(t) > 450:
            continue
        tags.append(t)
        total += len(t) + 1
    return tags


def _quota_error(resp: httpx.Response) -> PublishError | None:
    text = resp.text or ""
    if "quotaExceeded" in text or "uploadLimitExceeded" in text:
        return PublishError("Se agotó la cuota diaria de la API de YouTube (≈6 subidas/día por defecto). Intenta mañana o pide más cuota.")
    return None


def publish(ctx: PublishContext) -> PublishResult:
    http = ctx.http
    size = ctx.file_size
    desc = common.clamp((ctx.pub.get("caption") or "").replace("<", "").replace(">", ""), 5000)
    body = {
        "snippet": {
            "title": build_title(ctx), "description": desc, "tags": build_tags(ctx),
            "categoryId": "22",
        },
        "status": {
            "privacyStatus": ctx.pub.get("privacy") or "public",
            "selfDeclaredMadeForKids": False,
        },
    }
    headers = {
        "Authorization": f"Bearer {ctx.access_token}",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": str(size),
        "X-Upload-Content-Type": "video/mp4",
    }
    ctx.set_status("uploading")
    try:
        init = common.request(
            http, "POST", UPLOAD_URL, params={"uploadType": "resumable", "part": "snippet,status"},
            headers=headers, content=json.dumps(body), what="YouTube",
        )
    except PublishError as exc:
        if "quotaExceeded" in str(exc) or "uploadLimitExceeded" in str(exc):
            raise PublishError("Se agotó la cuota diaria de la API de YouTube (≈6 subidas/día por defecto).") from exc
        raise
    session = init.headers.get("location")
    if not session:
        raise PublishError("YouTube no devolvió la URL de subida reanudable.")

    sent = 0
    failures = 0
    final: dict | None = None
    while final is None:
        length = min(CHUNK, size - sent)
        chunk = common.read_range(ctx.video_path, sent, length)
        h = {
            "Authorization": f"Bearer {ctx.access_token}",
            "Content-Length": str(len(chunk)),
            "Content-Type": "video/mp4",
            "Content-Range": f"bytes {sent}-{sent + len(chunk) - 1}/{size}",
        }
        try:
            resp = http.put(session, content=chunk, headers=h)
        except httpx.TransportError as exc:
            failures += 1
            if failures > 5:
                raise PublishError(f"Se cortó la subida a YouTube: {exc}") from exc
            common.sleep(2 * failures)
            sent = _resume_offset(http, session, ctx.access_token, size, sent)
            continue
        if resp.status_code in (200, 201):
            final = resp.json()
        elif resp.status_code == 308:
            sent = _parse_range(resp.headers.get("range"), default=sent + len(chunk))
            failures = 0
            ctx.progress(min(0.95, sent / size * 0.95))
        elif resp.status_code in (500, 502, 503, 504):
            failures += 1
            if failures > 5:
                raise PublishError(f"YouTube respondió {resp.status_code} repetidamente durante la subida.")
            common.sleep(2 * failures)
            sent = _resume_offset(http, session, ctx.access_token, size, sent)
        elif resp.status_code == 401:
            raise AuthExpired("YouTube rechazó el token durante la subida. Reconecta la cuenta.")
        else:
            q = _quota_error(resp)
            if q:
                raise q
            raise PublishError(f"YouTube respondió {resp.status_code}: {common._error_message(resp)}")
    vid = final.get("id")
    if not vid:
        raise PublishError("YouTube no devolvió el id del video.")
    ctx.progress(1.0)
    return PublishResult(external_id=vid, external_url=f"https://youtube.com/shorts/{vid}"
                         if ctx.duration_s <= 60 else f"https://youtu.be/{vid}")


def _parse_range(value: str | None, default: int) -> int:
    """Cabecera 'Range: bytes=0-8388607' -> siguiente offset."""
    if not value:
        return default
    m = re.search(r"-(\d+)\s*$", value)
    return int(m.group(1)) + 1 if m else default


def _resume_offset(http: httpx.Client, session: str, token: str, size: int, fallback: int) -> int:
    """Pregunta a YouTube cuántos bytes recibió (PUT con Content-Range: bytes */total)."""
    try:
        r = http.put(session, content=b"", headers={
            "Authorization": f"Bearer {token}", "Content-Length": "0", "Content-Range": f"bytes */{size}"})
    except httpx.TransportError:
        return fallback
    if r.status_code == 308:
        return _parse_range(r.headers.get("range"), default=0)
    return fallback
