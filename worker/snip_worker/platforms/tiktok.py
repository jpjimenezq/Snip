"""TikTok Content Posting API (FILE_UPLOAD).

Referencia: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
            https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
Sin verificar contra la API real (escrito desde la documentación).

Flujo: creator_info -> direct post (video/init) -> subida por trozos a upload_url -> status/fetch.
Si la app no está auditada (o falta el scope video.publish) el direct post falla y se usa la
bandeja (inbox/video/init): el usuario termina de publicar desde la app de TikTok.
"""
from __future__ import annotations

import os

import httpx

from . import common
from .common import AuthExpired, PublishContext, PublishError, PublishResult

API = "https://open.tiktokapis.com"
MIN_CHUNK = 5 * 1024 * 1024
CHUNK = 10 * 1024 * 1024
POLL_TRIES = 60
POLL_EVERY_S = 5

PRIVACY = {"public": "PUBLIC_TO_EVERYONE", "unlisted": "FOLLOWER_OF_CREATOR", "private": "SELF_ONLY"}
# Códigos de error del direct post que justifican caer a la bandeja.
FALLBACK_CODES = {
    "unaudited_client_can_only_post_to_private_accounts",
    "scope_not_authorized",
    "privacy_level_option_mismatch",
    "url_ownership_unverified",
}
INBOX_NOTE = "Enviado a tu bandeja de TikTok para terminar de publicar"


def refresh(http: httpx.Client, tokens: dict) -> dict:
    key, secret = os.environ.get("TIKTOK_CLIENT_KEY", ""), os.environ.get("TIKTOK_CLIENT_SECRET", "")
    if not key or not secret:
        raise PublishError("Faltan TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET en worker/.env para renovar el token de TikTok.")
    if not tokens.get("refresh_token"):
        raise AuthExpired("La cuenta de TikTok no tiene refresh_token. Reconéctala.")
    resp = http.post(f"{API}/v2/oauth/token/", data={
        "client_key": key, "client_secret": secret,
        "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"]})
    body = _json(resp)
    if resp.status_code != 200 or not body.get("access_token"):
        msg = body.get("error_description") or body.get("error") or resp.text[:200]
        raise AuthExpired(f"TikTok rechazó la renovación ({msg}). Reconecta la cuenta de TikTok.")
    return body


def _json(resp: httpx.Response) -> dict:
    try:
        data = resp.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


class _ApiError(PublishError):
    def __init__(self, code: str, message: str):
        super().__init__(f"TikTok: {message or code} ({code})")
        self.code = code


def _call(ctx: PublishContext, path: str, body: dict | None = None) -> dict:
    resp = ctx.http.post(
        f"{API}{path}", json=body or {},
        headers={"Authorization": f"Bearer {ctx.access_token}", "Content-Type": "application/json; charset=UTF-8"})
    data = _json(resp)
    err = data.get("error") or {}
    code = err.get("code", "ok" if resp.status_code == 200 else f"http_{resp.status_code}")
    if code in ("access_token_invalid", "token_expired") or resp.status_code == 401:
        raise AuthExpired("TikTok rechazó el token. Reconecta la cuenta.")
    if code != "ok":
        raise _ApiError(code, err.get("message", ""))
    return data.get("data") or {}


def _plan_chunks(size: int) -> tuple[int, int]:
    """(chunk_size, total_chunk_count) según las reglas de TikTok: <5 MB en un solo trozo;
    el último trozo absorbe el resto (hasta 128 MB)."""
    if size < MIN_CHUNK:
        return size, 1
    return CHUNK, max(1, size // CHUNK)


def _upload(ctx: PublishContext, upload_url: str, chunk_size: int, total: int) -> None:
    size = ctx.file_size
    for i in range(total):
        start = i * chunk_size
        end = size - 1 if i == total - 1 else start + chunk_size - 1
        data = common.read_range(ctx.video_path, start, end - start + 1)
        common.request(
            ctx.http, "PUT", upload_url, content=data, ok=(200, 201, 206), what="la subida de TikTok",
            headers={"Content-Type": "video/mp4", "Content-Length": str(len(data)),
                     "Content-Range": f"bytes {start}-{end}/{size}"})
        ctx.progress(0.9 * (end + 1) / size)


def _poll(ctx: PublishContext, publish_id: str, inbox: bool) -> tuple[str | None, str | None]:
    """Devuelve (post_id, nota)."""
    ctx.set_status("processing")
    last = ""
    for _ in range(POLL_TRIES):
        data = _call(ctx, "/v2/post/publish/status/fetch/", {"publish_id": publish_id})
        last = data.get("status", "")
        if last == "FAILED":
            raise PublishError(f"TikTok no pudo procesar el video: {data.get('fail_reason', 'desconocido')}")
        if last == "PUBLISH_COMPLETE":
            ids = data.get("publicaly_available_post_id") or data.get("publicly_available_post_id") or []
            return (str(ids[0]) if ids else None), None
        if last == "SEND_TO_USER_INBOX":
            return None, INBOX_NOTE
        common.sleep(POLL_EVERY_S)
    return None, f"TikTok sigue procesando el video (último estado: {last or 'desconocido'})"


def publish(ctx: PublishContext) -> PublishResult:
    caption = common.clamp(ctx.caption, 2200)
    size = ctx.file_size
    chunk_size, total = _plan_chunks(size)
    source = {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": chunk_size, "total_chunk_count": total}
    ctx.set_status("uploading")

    # 1) Información del creador (límites y privacidades permitidas).
    privacy = PRIVACY.get(ctx.pub.get("privacy") or "public", "SELF_ONLY")
    try:
        info = _call(ctx, "/v2/post/publish/creator_info/query/")
        options = info.get("privacy_level_options") or []
        max_s = info.get("max_video_post_duration_sec")
        if max_s and ctx.duration_s > float(max_s):
            raise PublishError(f"El video dura {ctx.duration_s:.0f}s y tu cuenta de TikTok admite máximo {max_s}s.")
        if options and privacy not in options:
            privacy = "SELF_ONLY" if "SELF_ONLY" in options else options[0]
    except _ApiError:
        pass  # si falla la consulta, intentamos igual y que el init decida

    # 2) Direct post; si la app no está auditada, bandeja.
    inbox = False
    try:
        init = _call(ctx, "/v2/post/publish/video/init/", {
            "post_info": {"title": caption, "privacy_level": privacy, "disable_duet": False,
                          "disable_comment": False, "disable_stitch": False, "video_cover_timestamp_ms": 1000},
            "source_info": source})
    except _ApiError as exc:
        if exc.code not in FALLBACK_CODES:
            raise
        inbox = True
        init = _call(ctx, "/v2/post/publish/inbox/video/init/", {"source_info": source})

    publish_id, upload_url = init.get("publish_id"), init.get("upload_url")
    if not publish_id or not upload_url:
        raise PublishError("TikTok no devolvió publish_id/upload_url.")
    _upload(ctx, upload_url, chunk_size, total)
    post_id, note = _poll(ctx, publish_id, inbox)
    if inbox:
        note = INBOX_NOTE
    url = f"https://www.tiktok.com/@/video/{post_id}" if post_id else None
    return PublishResult(external_id=post_id or publish_id, external_url=url, note=note)
