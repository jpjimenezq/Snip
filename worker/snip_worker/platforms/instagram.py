"""Instagram Reels vía Graph API (cuenta profesional ligada a una página de Facebook).

Referencia: https://developers.facebook.com/docs/instagram-platform/content-publishing
Sin verificar contra la API real (escrito desde la documentación).

Flujo: POST /{ig-user-id}/media (REELS, video_url pública) -> poll status_code -> media_publish.
"""
from __future__ import annotations

from . import common
from .common import GRAPH, AuthExpired, PublishContext, PublishError, PublishResult

POLL_TRIES = 60
POLL_EVERY_S = 5


def graph_error(resp) -> str:
    return common._error_message(resp)


def graph(ctx: PublishContext, method: str, path: str, token: str, **kw):
    """Llamada a Graph API; el código 190 (token inválido) se traduce a AuthExpired."""
    params = kw.pop("params", {}) or {}
    data = kw.pop("data", None)
    if method == "GET":
        params = {**params, "access_token": token}
    else:
        data = {**(data or {}), "access_token": token}
    try:
        return common.request(ctx.http, method, f"{GRAPH}/{path.lstrip('/')}", params=params, data=data,
                              what="Graph API", **kw)
    except AuthExpired:
        raise
    except PublishError as exc:
        if "(#190)" in str(exc) or "Error validating access token" in str(exc):
            raise AuthExpired("Meta rechazó el token (expirado o revocado). Reconecta la cuenta.") from exc
        raise


def publish(ctx: PublishContext) -> PublishResult:
    ig_id = ctx.token_extra.get("ig_user_id") or ctx.account.get("external_id")
    token = ctx.token_extra.get("page_access_token") or ctx.access_token
    if (ctx.pub.get("privacy") or "public") != "public":
        raise PublishError("Instagram no permite publicar Reels privados o no listados por API; elige 'Público'.")
    ctx.set_status("processing")
    ctx.progress(0.1)
    video_url = ctx.signed_url()
    create = graph(ctx, "POST", f"{ig_id}/media", token, data={
        "media_type": "REELS", "video_url": video_url,
        "caption": common.clamp(ctx.caption, 2200), "share_to_feed": "true"})
    container = create.json().get("id")
    if not container:
        raise PublishError("Instagram no devolvió el id del contenedor.")

    status = ""
    for i in range(POLL_TRIES):
        st = graph(ctx, "GET", container, token, params={"fields": "status_code,status"}).json()
        status = st.get("status_code", "")
        if status == "FINISHED":
            break
        if status in ("ERROR", "EXPIRED"):
            raise PublishError(f"Instagram no pudo procesar el video ({status}): {st.get('status', '')}")
        ctx.progress(min(0.8, 0.1 + 0.7 * (i + 1) / POLL_TRIES))
        common.sleep(POLL_EVERY_S)
    else:
        raise PublishError("Instagram tardó demasiado en procesar el video (timeout).")

    pub = graph(ctx, "POST", f"{ig_id}/media_publish", token, data={"creation_id": container})
    media_id = pub.json().get("id")
    if not media_id:
        raise PublishError("Instagram no devolvió el id del medio publicado.")
    url = None
    try:
        url = graph(ctx, "GET", media_id, token, params={"fields": "permalink"}).json().get("permalink")
    except PublishError:
        pass  # el permalink es opcional
    ctx.progress(1.0)
    return PublishResult(external_id=str(media_id), external_url=url)
