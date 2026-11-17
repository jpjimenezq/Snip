"""Manejadores de cada tipo de job."""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from . import analyze, copies, db, ingest, transcribe
from .clipmath import manual_range, manual_title
from .config import get_settings
from .transcript_utils import text_in_range, words_in_range

log = logging.getLogger("snip.jobs")


def _render():
    from . import render  # lazy

    return render


# ---------------------------------------------------------------- utilidades
def _video_path(source: dict) -> Path:
    p = source.get("local_path")
    if p and Path(p).exists():
        return Path(p)
    return ingest.source_dir(source["id"]) / "source.mp4"


def _create_clip(
    source: dict,
    segments: list[dict],
    start: float,
    end: float,
    origin: str,
    title: str | None,
    hook: str | None = None,
    reason: str | None = None,
    score: int | None = None,
) -> str:
    """Inserta el clip, genera frame + preview, los sube y encola generate_copy."""
    render = _render()
    clip = db.insert_clip(
        {
            "source_id": source["id"],
            "user_id": source["user_id"],
            "origin": origin,
            "start_s": start,
            "end_s": end,
            "title": title,
            "hook": hook,
            "reason": reason,
            "score": score,
            "layout": None,
            "subtitle_style": "karaoke",
            "status": "suggested",
        }
    )
    clip_id = clip["id"]
    video = str(_video_path(source))
    work = get_settings().data_dir / "clips" / clip_id
    work.mkdir(parents=True, exist_ok=True)
    try:
        frame = work / "frame.jpg"
        render.extract_frame(video, start, str(frame))
        preview = work / "preview.mp4"
        render.make_preview(video, start, end, str(preview))
        db.upload_file(db.frame_key(clip_id), frame, "image/jpeg")
        db.upload_file(db.preview_key(clip_id), preview, "video/mp4")
        db.update_clip(clip_id, frame_path=db.frame_key(clip_id), preview_path=db.preview_key(clip_id))
    except Exception as exc:
        log.warning("No se pudo generar frame/preview del clip %s: %s", clip_id, exc)
    db.enqueue_job(source["user_id"], "generate_copy", {"clip_id": clip_id})
    return clip_id


def _segments_of(source_id: str) -> list[dict]:
    t = db.get_transcript(source_id)
    return (t or {}).get("segments") or []


# ---------------------------------------------------------------- process_source
def _drop_suggested_ai_clips(source_id: str) -> int:
    """Borra los clips de IA que siguen en 'suggested' (los renderizados, manuales y de
    atajo se conservan). Devuelve cuántos borró."""
    n = 0
    for c in db.list_clips(source_id):
        if c.get("origin") == "ai" and c.get("status") == "suggested":
            db.delete_clip(c["id"])
            n += 1
    return n


def _run_pipeline(source_id: str, force_analysis: bool = False) -> dict:
    """Descarga → transcribe → analiza. Devuelve la fila de source actualizada.
    Con force_analysis se descartan los clips de IA sugeridos y se vuelve a analizar
    (reutilizando la transcripción)."""
    source = db.get_source(source_id)
    s = get_settings()

    # 1) descarga
    db.set_source_status(source_id, "downloading", 0.0)
    log.info("Descargando: %s", source["url"])
    info = ingest.ingest(source, db.source_progress(source_id))
    upd = {
        "platform": info["platform"],
        "title": info["title"] or source.get("title"),
        "channel": info["channel"] or source.get("channel"),
        "duration_s": info["duration"],
        "local_path": info["video_path"],
        "progress": 1.0,
    }
    try:
        db.upload_file(db.thumb_key(source_id), info["thumb_path"], "image/jpeg")
        upd["thumb_path"] = db.thumb_key(source_id)
    except Exception as exc:
        log.warning("No se pudo subir la miniatura: %s", exc)
    db.update_source(source_id, **upd)
    source = db.get_source(source_id)

    # 2) transcripción (se reutiliza si ya existe)
    existing = db.get_transcript(source_id)
    if existing and existing.get("segments"):
        log.info("Se reutiliza la transcripción existente")
        segments = existing["segments"]
    else:
        db.set_source_status(source_id, "transcribing", 0.0)
        log.info("Transcribiendo con Whisper (%s)...", s.whisper_model)
        segments, language = transcribe.transcribe(info["audio_path"], db.source_progress(source_id))
        text = " ".join(seg["text"] for seg in segments).strip()
        db.upsert_transcript(source_id, language, text, segments)

    # 3) análisis con IA (no se duplica si ya hay clips de IA)
    if force_analysis:
        removed = _drop_suggested_ai_clips(source_id)
        log.info("Re-análisis forzado: %d clips de IA sugeridos descartados", removed)
    already = [c for c in db.list_clips(source_id) if c.get("origin") == "ai"]
    if already and not force_analysis:
        log.info("Ya hay %d clips de IA para este video; se omite el análisis", len(already))
    else:
        db.set_source_status(source_id, "analyzing", 0.0)
        log.info("Buscando momentos con Claude (%s)...", s.analysis_model)
        moments = analyze.find_moments(segments, source.get("duration_s"), db.source_progress(source_id))
        log.info("Claude propuso %d momentos tras ajustar", len(moments))
        for m in moments:
            _create_clip(source, segments, m["start_s"], m["end_s"], "ai",
                         m["title"], m["hook"], m["reason"], m["score"])
    db.set_source_status(source_id, "ready", 1.0)
    return db.get_source(source_id)


def ensure_source_ready(source_id: str, force_analysis: bool = False) -> dict:
    """Ejecuta el pipeline completo marcando el source como 'error' si falla."""
    try:
        return _run_pipeline(source_id, force_analysis)
    except BaseException as exc:
        if isinstance(exc, KeyboardInterrupt):
            raise
        db.set_source_status(source_id, "error", 0.0, _msg(exc))
        raise


def process_source(job: dict) -> None:
    p = job["payload"]
    ensure_source_ready(p["source_id"], force_analysis=bool(p.get("force_analysis")))


# ---------------------------------------------------------------- manual_clip
def manual_clip(job: dict) -> None:
    p = job["payload"]
    source_id = p["source_id"]
    source = db.get_source(source_id)
    segments = _segments_of(source_id)
    if source.get("status") != "ready" or not segments or not _video_path(source).exists():
        log.info("El video aún no está listo: se ejecuta el pipeline completo primero")
        source = ensure_source_ready(source_id)
        segments = _segments_of(source_id)
    start, end = manual_range(p["at_s"], p["duration_s"], source.get("duration_s"))
    title = manual_title(segments, start, end)
    cid = _create_clip(source, segments, start, end, "manual", title)
    log.info("Clip manual creado %s (%.1fs → %.1fs)", cid, start, end)


# ---------------------------------------------------------------- render_clip
def render_clip(job: dict) -> None:
    clip_id = job["payload"]["clip_id"]
    try:
        _do_render(clip_id)
    except BaseException as exc:
        if isinstance(exc, KeyboardInterrupt):
            raise
        db.update_clip(clip_id, status="error", error=_msg(exc))
        raise


def _do_render(clip_id: str) -> None:
    render = _render()
    s = get_settings()
    clip = db.get_clip(clip_id)
    source = db.get_source(clip["source_id"])
    segments = _segments_of(source["id"])
    start, end = float(clip["start_s"]), float(clip["end_s"])
    words = words_in_range(segments, start, end)
    video = _video_path(source)
    if not video.exists():
        raise RuntimeError(f"No existe el video fuente en disco: {video}")
    out_dir = s.data_dir / "renders" / clip_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "final.mp4"
    db.update_clip(clip_id, status="rendering", progress=0.0, error=None)
    progress = db.clip_progress(clip_id)

    log.info("Renderizando clip %s con %s", clip_id, s.video_encoder)
    render.render_with_fallback(str(video), start, end, clip.get("layout"), words,
                                clip.get("subtitle_style") or "karaoke", str(out),
                                s.video_encoder, on_progress=progress)
    db.upload_file(db.final_key(clip_id), out, "video/mp4")
    db.update_clip(clip_id, status="rendered", progress=1.0, output_path=db.final_key(clip_id), error=None)


# ---------------------------------------------------------------- generate_copy
def generate_copy(job: dict) -> None:
    clip_id = job["payload"]["clip_id"]
    clip = db.get_clip(clip_id)
    source = db.get_source(clip["source_id"])
    segments = _segments_of(source["id"])
    text = text_in_range(segments, float(clip["start_s"]), float(clip["end_s"]))
    result = copies.generate_copies(text, clip.get("title"), source.get("channel"))
    db.update_clip(clip_id, copies=result)
    log.info("Copies generados para el clip %s", clip_id)


HANDLERS = {
    "process_source": process_source,
    "manual_clip": manual_clip,
    "render_clip": render_clip,
    "generate_copy": generate_copy,
}

# Fases 3 y 4 registran sus handlers en sus propios módulos.
from . import live_jobs, publish  # noqa: E402

HANDLERS.update(live_jobs.HANDLERS)
HANDLERS.update(publish.HANDLERS)


def _msg(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:1500]
