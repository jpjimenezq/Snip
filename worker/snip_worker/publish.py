"""Fase 4: publicación en redes (job publish_clip).

payload: {"publication_ids": ["..."]}. Por cada publicación: refresca el token si hace falta,
sube el video con el publicador de su plataforma y actualiza status/progress/external_*/error.
Un fallo no detiene a las demás; el job solo falla si TODAS fallan.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import httpx

from . import db
from .config import get_settings
from .platforms import facebook, instagram, tiktok, youtube
from .platforms.common import AuthExpired, PublishContext, PublishError, PublishResult

log = logging.getLogger("snip.publish")

PUBLISHERS: dict[str, Callable[[PublishContext], PublishResult]] = {
    "youtube": youtube.publish,
    "tiktok": tiktok.publish,
    "instagram": instagram.publish,
    "facebook": facebook.publish,
}
REFRESHERS = {"youtube": youtube.refresh, "tiktok": tiktok.refresh}
REFRESH_MARGIN = timedelta(minutes=5)


def new_http() -> httpx.Client:
    # Sin follow_redirects: YouTube usa 308 como "continúa" en la subida reanudable.
    return httpx.Client(timeout=httpx.Timeout(120.0, connect=20.0))


# ------------------------------------------------------------------ BD
def _update_pub(pub_id: str, **fields) -> None:
    db.client().table("publications").update(fields).eq("id", pub_id).execute()


def _get_one(table: str, col: str, value: str) -> dict | None:
    rows = db.client().table(table).select("*").eq(col, value).limit(1).execute().data or []
    return rows[0] if rows else None


def _parse_ts(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


# ------------------------------------------------------------------ tokens
def ensure_fresh_token(http: httpx.Client, account: dict, tokens: dict) -> dict:
    """Devuelve tokens vigentes (refrescando y guardando si hace falta). Lanza AuthExpired."""
    platform = account["platform"]
    expires = _parse_ts(tokens.get("expires_at"))
    now = datetime.now(timezone.utc)
    if expires is None or expires - now > REFRESH_MARGIN:
        return tokens
    refresher = REFRESHERS.get(platform)
    if refresher is None:
        # Meta: los tokens de larga duración (60 días) no se renuevan sin el usuario.
        raise AuthExpired("El token de Meta expiró (dura ~60 días). Reconecta la cuenta en Ajustes.")
    data = refresher(http, tokens)
    new = dict(tokens)
    new["access_token"] = data["access_token"]
    if data.get("refresh_token"):
        new["refresh_token"] = data["refresh_token"]
    if data.get("expires_in"):
        new["expires_at"] = (now + timedelta(seconds=int(data["expires_in"]))).isoformat()
    db.client().table("social_tokens").update({
        "access_token": new["access_token"],
        "refresh_token": new.get("refresh_token"),
        "expires_at": new.get("expires_at"),
        "updated_at": now.isoformat(),
    }).eq("account_id", account["id"]).execute()
    return new


def _mark_account_expired(account_id: str, message: str) -> None:
    try:
        db.client().table("social_accounts").update(
            {"status": "expired", "error": message[:500]}).eq("id", account_id).execute()
    except Exception as exc:  # noqa: BLE001
        log.warning("No se pudo marcar la cuenta como expirada: %s", exc)


# ------------------------------------------------------------------ video
def _signed_url(clip_id: str, seconds: int = 3600) -> str:
    res = db.client().storage.from_(db.BUCKET).create_signed_url(db.final_key(clip_id), seconds)
    url = res.get("signedURL") or res.get("signedUrl") or ""
    if url.startswith("/"):
        base = get_settings().supabase_url.rstrip("/")
        url = base + ("/storage/v1" if not url.startswith("/storage/") else "") + url
    return url


def ensure_video(clip_id: str) -> tuple[dict, Path]:
    """Renderiza si hace falta y devuelve (clip, ruta local del final.mp4)."""
    clip = db.get_clip(clip_id)
    if clip.get("status") != "rendered" or not clip.get("output_path"):
        from . import jobs  # import perezoso: jobs importa este módulo al final

        log.info("Clip %s sin renderizar: renderizando antes de publicar", clip_id)
        jobs._do_render(clip_id)
        clip = db.get_clip(clip_id)
    s = get_settings()
    local = s.data_dir / "renders" / clip_id / "final.mp4"
    if local.exists():
        return clip, local
    key = clip.get("output_path") or db.final_key(clip_id)
    data = db.client().storage.from_(db.BUCKET).download(key)
    tmp = s.data_dir / "publish_tmp" / clip_id / "final.mp4"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(data)
    return clip, tmp


# ------------------------------------------------------------------ una publicación
def publish_one(pub: dict, clip: dict, video: Path, http: httpx.Client) -> PublishResult:
    pub_id = pub["id"]
    account = _get_one("social_accounts", "id", pub["account_id"])
    if not account:
        raise PublishError("La cuenta ya no existe (¿la desconectaste?).")
    tok = _get_one("social_tokens", "account_id", account["id"])
    if not tok:
        raise AuthExpired("La cuenta no tiene tokens guardados. Reconéctala en Ajustes.")
    publisher = PUBLISHERS.get(pub["platform"])
    if publisher is None:
        raise PublishError(f"Plataforma no soportada: {pub['platform']}")

    _update_pub(pub_id, status="uploading", progress=0.0, error=None)
    try:
        tokens = ensure_fresh_token(http, account, tok)
        progress = db.ProgressReporter(lambda v: _update_pub(pub_id, progress=v))
        ctx = PublishContext(
            http=http, pub=pub, clip=clip, account=account, tokens=tokens, video_path=video,
            duration_s=max(0.0, float(clip["end_s"]) - float(clip["start_s"])),
            progress=progress, set_status=lambda st: _update_pub(pub_id, status=st),
            signed_url=lambda: _signed_url(clip["id"]),
        )
        result = publisher(ctx)
    except AuthExpired as exc:
        _mark_account_expired(account["id"], str(exc))
        raise
    _update_pub(pub_id, status="published", progress=1.0, external_id=result.external_id,
                external_url=result.external_url, error=result.note)
    return result


# ------------------------------------------------------------------ job
def publish_clip(job: dict) -> None:
    ids = list((job.get("payload") or {}).get("publication_ids") or [])
    if not ids:
        raise RuntimeError("publish_clip sin publication_ids")
    pubs = db.client().table("publications").select("*").in_("id", ids).execute().data or []
    if not pubs:
        raise RuntimeError("No se encontraron las publicaciones indicadas")

    by_clip: dict[str, list[dict]] = {}
    for p in pubs:
        by_clip.setdefault(p["clip_id"], []).append(p)

    failures: list[str] = []
    done = 0
    http = new_http()
    try:
        for clip_id, group in by_clip.items():
            try:
                clip, video = ensure_video(clip_id)
            except Exception as exc:  # noqa: BLE001 - el render falló: todas las del clip fallan
                msg = f"No se pudo preparar el video: {exc}"[:500]
                for p in group:
                    _update_pub(p["id"], status="error", error=msg)
                    failures.append(f"{p['platform']}: {msg}")
                continue
            for p in group:
                try:
                    publish_one(p, clip, video, http)
                    done += 1
                except Exception as exc:  # noqa: BLE001 - aislar errores entre publicaciones
                    msg = (str(exc) or type(exc).__name__)[:500]
                    log.warning("Publicación %s (%s) falló: %s", p["id"], p["platform"], msg)
                    try:
                        _update_pub(p["id"], status="error", error=msg)
                    except Exception:  # noqa: BLE001
                        pass
                    failures.append(f"{p['platform']}: {msg}")
    finally:
        http.close()
    if done == 0:
        raise RuntimeError("Fallaron todas las publicaciones: " + " | ".join(failures))


HANDLERS = {"publish_clip": publish_clip}
