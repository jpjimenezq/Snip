"""Facebook: Reel en una página (video_reels) con respaldo a /{page-id}/videos con file_url.

Referencia: https://developers.facebook.com/docs/video-api/guides/reels-publishing
Sin verificar contra la API real (escrito desde la documentación). Requiere el page access token
guardado en social_tokens.extra.page_access_token.
"""
from __future__ import annotations

import json

from . import common
from .common import GRAPH, AuthExpired, PublishContext, PublishError, PublishResult
from .instagram import graph

POLL_TRIES = 36
POLL_EVERY_S = 5


def _reel(ctx: PublishContext, page_id: str, token: str, state: str) -> PublishResult:
    size = ctx.file_size
    start = graph(ctx, "POST", f"{page_id}/video_reels", token, data={"upload_phase": "start"}).json()
    video_id, upload_url = start.get("video_id"), start.get("upload_url")
    if not video_id or not upload_url:
        raise PublishError("Facebook no devolvió video_id/upload_url para el Reel.")
    ctx.set_status("uploading")
    ctx.progress(0.1)
    # Subida binaria a rupload.facebook.com (el encabezado es "OAuth", no "Bearer").
    common.request(
        ctx.http, "POST", upload_url, content=common.read_chunks(ctx.video_path, 0, size),
        what="la subida de Facebook",
        headers={"Authorization": f"OAuth {token}", "offset": "0", "file_size": str(size),
                 "Content-Length": str(size), "Content-Type": "application/octet-stream"})
    ctx.progress(0.7)
    ctx.set_status("processing")
    graph(ctx, "POST", f"{page_id}/video_reels", token, data={
        "upload_phase": "finish", "video_id": video_id, "video_state": state,
        "description": common.clamp(ctx.caption, 2200)})
    url = None
    for _ in range(POLL_TRIES):
        st = graph(ctx, "GET", str(video_id), token, params={"fields": "status,permalink_url"}).json()
        vs = ((st.get("status") or {}).get("video_status") or "").lower()
        if st.get("permalink_url"):
            url = st["permalink_url"]
            if url.startswith("/"):
                url = "https://www.facebook.com" + url
        if vs in ("ready", "complete", "published"):
            break
        if vs == "error":
            raise PublishError("Facebook no pudo procesar el Reel.")
        common.sleep(POLL_EVERY_S)
    ctx.progress(1.0)
    note = "Guardado como borrador en tu página de Facebook" if state == "DRAFT" else None
    return PublishResult(external_id=str(video_id), external_url=url or f"https://www.facebook.com/reel/{video_id}", note=note)


def _video_fallback(ctx: PublishContext, page_id: str, token: str, privacy: str) -> PublishResult:
    data = {"file_url": ctx.signed_url(), "description": common.clamp(ctx.caption, 2200)}
    if privacy == "private":
        data["privacy"] = json.dumps({"value": "SELF"})
    ctx.set_status("processing")
    res = graph(ctx, "POST", f"{page_id}/videos", token, data=data).json()
    vid = res.get("id")
    if not vid:
        raise PublishError("Facebook no devolvió el id del video.")
    url = None
    try:
        url = graph(ctx, "GET", str(vid), token, params={"fields": "permalink_url"}).json().get("permalink_url")
        if url and url.startswith("/"):
            url = "https://www.facebook.com" + url
    except PublishError:
        pass
    ctx.progress(1.0)
    return PublishResult(external_id=str(vid), external_url=url or f"https://www.facebook.com/{vid}")


def publish(ctx: PublishContext) -> PublishResult:
    page_id = ctx.account.get("external_id")
    token = ctx.token_extra.get("page_access_token") or ctx.access_token
    privacy = ctx.pub.get("privacy") or "public"
    if privacy == "unlisted":
        raise PublishError("Facebook no tiene videos 'no listados'; elige 'Público' o 'Privado' (borrador).")
    state = "DRAFT" if privacy == "private" else "PUBLISHED"
    try:
        return _reel(ctx, page_id, token, state)
    except AuthExpired:
        raise
    except PublishError as exc:
        common.log.warning("Reel de Facebook falló (%s); probando /videos con file_url", exc)
        try:
            return _video_fallback(ctx, page_id, token, privacy)
        except AuthExpired:
            raise
        except PublishError as exc2:
            raise PublishError(f"Reel: {exc} | Respaldo /videos: {exc2}") from exc2
