"""Fase 3: job live_clip — corta un tramo del búfer en vivo y lo convierte en source + clip."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from . import db, ingest, transcribe
from . import live_utils as lu
from .transcript_utils import text_in_range

log = logging.getLogger("snip.live_jobs")

MIN_DURATION_S = 3.0


def _parse_iso(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    v = value.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _find_or_create_watch(user_id: str, target: lu.LiveTarget) -> tuple[dict | None, str | None]:
    """Devuelve (watch usable, mensaje de error). watch=None si hubo que crearlo/activarlo."""
    rows = db.client().table("live_watches").select("*").eq("user_id", user_id).execute().data or []
    match = None
    for w in rows:
        try:
            if lu.normalize_live_url(w["url"]).key == target.key:
                match = w
                break
        except ValueError:
            continue
    started = ("No estaba grabando este canal; ya empecé a grabarlo, intenta de nuevo en unos segundos.")
    if match is None:
        db.client().table("live_watches").insert({
            "user_id": user_id, "url": target.url, "platform": target.platform,
            "channel": target.channel, "enabled": True,
        }).execute()
        return None, started
    if not match.get("enabled"):
        db.client().table("live_watches").update({"enabled": True}).eq("id", match["id"]).execute()
        return None, started
    return match, None


def live_clip(job: dict) -> None:
    p = job["payload"]
    user_id = job["user_id"]
    target = lu.normalize_live_url(p["url"])
    duration = max(MIN_DURATION_S, float(p.get("duration_s") or 30))
    requested = _parse_iso(p.get("requested_at"))

    watch, err = _find_or_create_watch(user_id, target)
    if err:
        raise RuntimeError(err)
    wdir = lu.watch_dir(watch["id"])
    if not lu.list_segments(wdir):
        raise RuntimeError(
            "El canal está en la lista pero todavía no hay video en el búfer "
            f"(estado: {watch.get('status')}). Si está fuera de línea no se puede clipear; "
            "intenta de nuevo cuando esté en vivo.")

    win_end = requested - timedelta(seconds=lu.get_delay_s())
    win_start = win_end - timedelta(seconds=duration)
    source_id = str(uuid.uuid4())
    out_dir = ingest.source_dir(source_id)
    cut = lu.cut_window(wdir, win_start, win_end, out_dir)
    log.info("Tramo cortado del búfer: %.1fs (faltaron %.1fs)", cut.duration_s, cut.short_by_s)

    channel = target.channel or watch.get("channel")
    local = cut.end.astimezone()
    title = f"En vivo · {channel} · {local:%H:%M}"
    db.client().table("sources").insert({
        "id": source_id, "user_id": watch["user_id"], "url": watch["url"],
        "platform": target.platform, "title": title, "channel": channel,
        "duration_s": cut.duration_s, "status": "transcribing", "progress": 0.0,
        "local_path": str(cut.video),
    }).execute()

    try:
        segments, language = transcribe.transcribe(str(cut.wav), db.source_progress(source_id))
        text = " ".join(seg["text"] for seg in segments).strip()
        db.upsert_transcript(source_id, language, text, segments)
        try:
            from .render import extract_frame

            thumb = out_dir / "thumb.jpg"
            extract_frame(str(cut.video), cut.duration_s / 2, str(thumb))
            db.upload_file(db.thumb_key(source_id), thumb, "image/jpeg")
            db.update_source(source_id, thumb_path=db.thumb_key(source_id))
        except Exception as exc:
            log.warning("No se pudo crear la miniatura: %s", exc)
        db.set_source_status(source_id, "ready", 1.0)
    except BaseException as exc:
        if isinstance(exc, KeyboardInterrupt):
            raise
        db.set_source_status(source_id, "error", 0.0, f"{type(exc).__name__}: {exc}"[:1500])
        raise

    source = db.get_source(source_id)
    said = " ".join(text_in_range(segments, 0, cut.duration_s).split())
    clip_title = (" ".join(said.split()[:8]) + ("…" if len(said.split()) > 8 else "")) if said else f"Clip en vivo {local:%H:%M}"
    reason = f"Clip rápido en vivo de {duration:.0f} s"
    if cut.short_by_s > 1.0:
        reason += f" (el búfer solo alcanzó {cut.duration_s:.0f} s; faltaron {cut.short_by_s:.0f} s)"
    from . import jobs  # import tardío: jobs importa este módulo al final

    clip_id = jobs._create_clip(source, segments, 0.0, round(cut.duration_s, 3), "hotkey",
                                clip_title[:80], reason=reason)
    log.info("Clip en vivo creado %s para %s", clip_id, title)


HANDLERS = {"live_clip": live_clip}
