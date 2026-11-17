"""Descarga de videos con yt-dlp y extracción de audio para Whisper."""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

from .config import get_settings

log = logging.getLogger("snip.ingest")

VIDEO_FORMAT = (
    "bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]/"
    "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/"
    "bv*[height<=1080]+ba/"
    "b[height<=1080]/b"
)


def detect_platform(url: str) -> str:
    host = (urlparse(url.strip()).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]

    def is_(domain: str) -> bool:
        return host == domain or host.endswith("." + domain)

    if is_("youtube.com") or is_("youtu.be") or is_("youtube-nocookie.com"):
        return "youtube"
    if is_("kick.com"):
        return "kick"
    if is_("twitch.tv") or is_("twitch.com"):
        return "twitch"
    return "other"


def source_dir(source_id: str) -> Path:
    d = get_settings().data_dir / "sources" / source_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _run_ffmpeg(args: list[str]) -> None:
    proc = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg falló: {proc.stderr.strip()[-800:]}")


def extract_audio(video_path: Path, wav_path: Path) -> Path:
    if wav_path.exists() and wav_path.stat().st_size > 0:
        return wav_path
    tmp = wav_path.with_suffix(".part.wav")
    _run_ffmpeg(["-i", str(video_path), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(tmp)])
    tmp.replace(wav_path)
    return wav_path


def _find_thumb(d: Path) -> Path | None:
    for ext in ("jpg", "jpeg", "png", "webp"):
        p = d / f"source.{ext}"
        if p.exists():
            return p
    return None


def download(url: str, d: Path, on_progress: Callable[[float], None] | None = None) -> tuple[Path, dict]:
    """Descarga el video (<=1080p, mp4) a d/source.mp4. Devuelve (ruta, metadatos)."""
    import yt_dlp

    video = d / "source.mp4"
    meta_file = d / "meta.json"
    if video.exists() and video.stat().st_size > 0 and meta_file.exists():
        log.info("El video ya está descargado, se omite la descarga: %s", video)
        return video, json.loads(meta_file.read_text(encoding="utf-8"))

    seen_files: list[str] = []

    def hook(h: dict) -> None:
        if h.get("status") != "downloading" or not on_progress:
            return
        fname = h.get("filename") or ""
        if fname not in seen_files:
            seen_files.append(fname)
        idx = seen_files.index(fname)
        total = h.get("total_bytes") or h.get("total_bytes_estimate")
        done = h.get("downloaded_bytes") or 0
        frac = None
        if total:
            frac = done / total
        elif h.get("fragment_count"):
            frac = (h.get("fragment_index") or 0) / h["fragment_count"]
        if frac is not None:
            frac = min(1.0, max(0.0, frac))
            # video (grande) ocupa 0-90 %, el audio separado 90-100 % (progreso monótono)
            overall = frac * 0.9 if idx == 0 else 0.9 + frac * 0.1
            on_progress(min(0.99, overall))

    class _Logger:
        def debug(self, msg):  # yt-dlp manda todo por debug
            if not str(msg).startswith("[debug]"):
                log.debug(msg)

        def info(self, msg):
            log.debug(msg)

        def warning(self, msg):
            log.warning("yt-dlp: %s", msg)

        def error(self, msg):
            log.error("yt-dlp: %s", msg)

    opts = {
        "format": VIDEO_FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": str(d / "source.%(ext)s"),
        "noplaylist": True,
        "writethumbnail": True,
        "retries": 10,
        "fragment_retries": 10,
        "concurrent_fragment_downloads": 4,
        "progress_hooks": [hook],
        "logger": _Logger(),
        "noprogress": True,
        "postprocessors": [
            {"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"},
            {"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"},
        ],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    if info and "entries" in info:  # por si la URL era una lista
        entries = [e for e in info["entries"] if e]
        info = entries[0] if entries else info

    if not video.exists():
        candidates = sorted(d.glob("source.*"), key=lambda p: p.stat().st_size, reverse=True)
        candidates = [c for c in candidates if c.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov", ".ts")]
        if not candidates:
            raise RuntimeError("yt-dlp terminó pero no se encontró el archivo de video")
        if candidates[0] != video:
            _run_ffmpeg(["-i", str(candidates[0]), "-c", "copy", str(video)])

    meta = {
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader") or info.get("uploader_id"),
        "duration": info.get("duration"),
    }
    meta_file.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return video, meta


def ingest(source: dict, on_progress: Callable[[float], None] | None = None) -> dict:
    """Descarga + audio + thumbnail. Devuelve dict con rutas y metadatos
    (video_path, audio_path, thumb_path, title, channel, duration, platform)."""
    from . import render  # lazy: el paquete render lo construye otro módulo

    d = source_dir(source["id"])
    video, meta = download(source["url"], d, on_progress)
    probe = render.probe(str(video))
    duration = probe.get("duration") or meta.get("duration")
    audio = extract_audio(video, d / "audio.wav")

    thumb = _find_thumb(d)
    jpg = d / "thumb.jpg"
    if thumb is not None and thumb.suffix.lower() in (".jpg", ".jpeg"):
        jpg = thumb
    elif thumb is not None:
        try:
            _run_ffmpeg(["-i", str(thumb), str(jpg)])
        except Exception:
            thumb = None
    if thumb is None or not jpg.exists():
        jpg = d / "thumb.jpg"
        render.extract_frame(str(video), min(max(1.0, (duration or 10) * 0.1), max(0.0, (duration or 10) - 1)), str(jpg))

    return {
        "video_path": str(video),
        "audio_path": str(audio),
        "thumb_path": str(jpg),
        "title": meta.get("title"),
        "channel": meta.get("channel"),
        "duration": float(duration) if duration else None,
        "platform": detect_platform(source["url"]),
    }
