"""Snip video render engine (ffmpeg based)."""
from __future__ import annotations

import logging
import os
import tempfile
from typing import Callable

from .errors import RenderError
from .ffmpeg import run_ffmpeg
from .layouts import build_filtergraph, divider_y, normalize_layout, region_to_pixels
from .probe import probe
from .subtitles import generate_ass
from .zoom import auto_zooms, merge_zooms

log = logging.getLogger("snip.render")

__all__ = ["RenderError", "probe", "extract_frame", "make_preview", "render_clip",
           "render_with_fallback"]


def _ensure_parent(path: str) -> str:
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def extract_frame(source_path: str, t: float, out_path: str) -> None:
    """Save the source frame at time `t` as a high-quality JPEG (accurate seek)."""
    out = _ensure_parent(out_path)
    run_ffmpeg(["-ss", f"{max(0.0, t):.3f}", "-i", os.path.abspath(source_path),
                "-frames:v", "1", "-q:v", "2", "-update", "1", out])


def make_preview(source_path: str, start: float, end: float, out_path: str) -> None:
    """Horizontal 480p ~800 kbps preview of [start, end]."""
    if end <= start:
        raise RenderError(f"invalid range: start={start} end={end}")
    out = _ensure_parent(out_path)
    run_ffmpeg([
        "-ss", f"{max(0.0, start):.3f}", "-i", os.path.abspath(source_path),
        "-t", f"{end - start:.3f}", "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", "scale=-2:480", "-c:v", "libx264", "-preset", "veryfast",
        "-b:v", "800k", "-maxrate", "1000k", "-bufsize", "1600k", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out,
    ], duration=end - start)


def _video_codec_args(encoder: str) -> list[str]:
    if encoder == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "21", "-b:v", "0",
                "-profile:v", "high"]
    if encoder == "libx264":
        return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high"]
    raise RenderError(f"unsupported encoder: {encoder}")


def _plan_edits(src: str, layout: dict | None, start: float, duration: float, info: dict
                ) -> tuple[list[dict | None], list[dict], tuple[float, float]]:
    """Phase-2 edits: face-tracking trajectories, merged zoom timeline and zoom center.
    Any failure degrades to the static (phase 1) behaviour."""
    n = normalize_layout(layout)
    tracks: list[dict | None] = []
    if n["track_face"] and n["regions"]:
        try:
            from .tracking import compute_tracks
            boxes = [region_to_pixels(r, info["width"], info["height"]) for r in n["regions"]]
            tracks = compute_tracks(src, start, duration, info["width"], info["height"], boxes,
                                    expand_x=1.0 if n["preset"] == "fill" else 0.5)
        except Exception as e:  # noqa: BLE001
            log.warning("face tracking failed, using static regions: %s", e)
            tracks = []
    auto = auto_zooms(src, start, duration) if n["auto_zoom"] else []
    zooms = merge_zooms(n["zooms"], auto, duration)
    center = (0.5, 0.5)
    if n["preset"] == "fill" and tracks and tracks[0]:
        center = (0.5, tracks[0]["face_rel_y"])
    return tracks, zooms, center


def render_clip(source_path: str, start: float, end: float, layout: dict | None,
                words: list[dict], subtitle_style: str, out_path: str,
                encoder: str = "h264_nvenc",
                on_progress: Callable[[float], None] | None = None) -> None:
    """Render a 1080x1920 H.264/AAC clip of [start, end] with the given layout and subtitles."""
    src = os.path.abspath(source_path)
    info = probe(src)
    start = max(0.0, float(start))
    if info["duration"] > 0:
        end = min(float(end), info["duration"])
    duration = end - start
    if duration <= 0.05:
        raise RenderError(f"invalid range: start={start} end={end}")
    out = _ensure_parent(out_path)
    codec = _video_codec_args(encoder)

    with tempfile.TemporaryDirectory(prefix="snip_render_", ignore_cleanup_errors=True) as tmp:
        ass_name = None
        ass = generate_ass(words, start, end, subtitle_style, divider_y(layout))
        if ass is not None:
            ass_name = "subs.ass"
            with open(os.path.join(tmp, ass_name), "w", encoding="utf-8") as f:
                f.write(ass)
        tracks, zooms, center = _plan_edits(src, layout, start, duration, info)
        graph = build_filtergraph(layout, info["width"], info["height"], info["fps"], ass_name,
                                  tracks=tracks, zooms=zooms, zoom_center=center)
        run_ffmpeg([
            "-ss", f"{start:.3f}", "-i", src, "-t", f"{duration:.3f}",
            "-filter_complex", graph, "-map", "[vout]", "-map", "0:a:0?",
            *codec, "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
            "-movflags", "+faststart", out,
        ], duration=duration, on_progress=on_progress, cwd=tmp)


def render_with_fallback(source_path: str, start: float, end: float, layout: dict | None,
                         words: list[dict], subtitle_style: str, out_path: str, encoder: str,
                         on_progress: Callable[[float], None] | None = None) -> str:
    """render_clip con `encoder`; si falla y no era libx264, reintenta con libx264 (CPU).
    Devuelve el codificador que se usó."""
    try:
        render_clip(source_path, start, end, layout, words, subtitle_style, out_path,
                    encoder=encoder, on_progress=on_progress)
        return encoder
    except Exception as exc:  # noqa: BLE001
        if encoder == "libx264":
            raise
        log.warning("Falló el render con %s (%s). Reintentando con libx264 (CPU)...", encoder, exc)
        render_clip(source_path, start, end, layout, words, subtitle_style, out_path,
                    encoder="libx264", on_progress=on_progress)
        return "libx264"
