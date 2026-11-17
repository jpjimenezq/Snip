"""Acceso a Supabase (service role): jobs, sources, clips, transcripts y Storage."""
from __future__ import annotations

import logging
import mimetypes
import time
from pathlib import Path
from typing import Any, Callable

from supabase import Client, create_client

from .config import get_settings

log = logging.getLogger("snip.db")

BUCKET = "clips"
PROGRESS_INTERVAL_S = 2.0

_client: Client | None = None


def client() -> Client:
    global _client
    if _client is None:
        s = get_settings()
        s.require_supabase()
        _client = create_client(s.supabase_url, s.supabase_service_role_key)
    return _client


# ---------- keys de Storage ----------
def thumb_key(source_id: str) -> str:
    return f"sources/{source_id}/thumb.jpg"


def frame_key(clip_id: str) -> str:
    return f"clips/{clip_id}/frame.jpg"


def preview_key(clip_id: str) -> str:
    return f"clips/{clip_id}/preview.mp4"


def final_key(clip_id: str) -> str:
    return f"clips/{clip_id}/final.mp4"


# ---------- jobs ----------
def claim_job(worker_id: str) -> dict | None:
    res = client().rpc("claim_job", {"p_worker_id": worker_id}).execute()
    data = res.data
    if not data:
        return None
    if isinstance(data, list):
        return data[0] if data else None
    return data if data.get("id") else None


def finish_job(job_id: str) -> None:
    client().table("jobs").update({"status": "done", "error": None}).eq("id", job_id).execute()


def fail_job(job_id: str, message: str) -> None:
    client().table("jobs").update({"status": "error", "error": message[:2000]}).eq(
        "id", job_id
    ).execute()


def enqueue_job(user_id: str, job_type: str, payload: dict) -> None:
    client().table("jobs").insert(
        {"user_id": user_id, "type": job_type, "payload": payload}
    ).execute()


# ---------- sources ----------
def get_source(source_id: str) -> dict:
    res = client().table("sources").select("*").eq("id", source_id).single().execute()
    return res.data


def update_source(source_id: str, **fields: Any) -> None:
    client().table("sources").update(fields).eq("id", source_id).execute()


def set_source_status(source_id: str, status: str, progress: float = 0.0, error: str | None = None) -> None:
    update_source(source_id, status=status, progress=progress, error=error)


# ---------- clips ----------
def get_clip(clip_id: str) -> dict:
    res = client().table("clips").select("*").eq("id", clip_id).single().execute()
    return res.data


def update_clip(clip_id: str, **fields: Any) -> None:
    client().table("clips").update(fields).eq("id", clip_id).execute()


def insert_clip(row: dict) -> dict:
    res = client().table("clips").insert(row).execute()
    return res.data[0]


def list_clips(source_id: str) -> list[dict]:
    res = client().table("clips").select("*").eq("source_id", source_id).execute()
    return res.data or []


# ---------- transcripts ----------
def get_transcript(source_id: str) -> dict | None:
    res = (
        client().table("transcripts").select("*").eq("source_id", source_id).limit(1).execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def upsert_transcript(source_id: str, language: str | None, text: str, segments: list[dict]) -> None:
    client().table("transcripts").upsert(
        {"source_id": source_id, "language": language, "text": text, "segments": segments},
        on_conflict="source_id",
    ).execute()


# ---------- Storage ----------
def upload_file(key: str, path: str | Path, content_type: str | None = None) -> str:
    ctype = content_type or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    with open(path, "rb") as f:
        data = f.read()
    client().storage.from_(BUCKET).upload(
        key, data, {"content-type": ctype, "upsert": "true", "cache-control": "3600"}
    )
    return key


# ---------- progreso con throttle ----------
class ProgressReporter:
    """Escribe progreso (0..1) en una fila como máximo cada ~2 s."""

    def __init__(self, writer: Callable[[float], None], interval: float = PROGRESS_INTERVAL_S):
        self._writer = writer
        self._interval = interval
        self._last = 0.0
        self._last_value = -1.0

    def __call__(self, value: float, force: bool = False) -> None:
        value = max(0.0, min(1.0, float(value)))
        now = time.monotonic()
        if not force and now - self._last < self._interval:
            return
        if value == self._last_value and not force:
            return
        self._last = now
        self._last_value = value
        try:
            self._writer(value)
        except Exception as exc:  # el progreso nunca debe romper el trabajo
            log.warning("No se pudo escribir el progreso: %s", exc)


def source_progress(source_id: str) -> ProgressReporter:
    return ProgressReporter(lambda v: update_source(source_id, progress=v))


def clip_progress(clip_id: str) -> ProgressReporter:
    return ProgressReporter(lambda v: update_clip(clip_id, progress=v))
