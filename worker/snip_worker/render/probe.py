"""ffprobe wrapper."""
from __future__ import annotations

import json

from .errors import RenderError
from .ffmpeg import run_ffprobe


def _parse_rate(s: str | None) -> float:
    if not s or s == "0/0":
        return 0.0
    if "/" in s:
        n, _, d = s.partition("/")
        try:
            return float(n) / float(d) if float(d) else 0.0
        except ValueError:
            return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def probe(path: str) -> dict:
    """Return {"width", "height", "duration", "fps"} for the first video stream."""
    out = run_ffprobe(["-print_format", "json", "-show_streams", "-show_format", path])
    data = json.loads(out)
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if v is None:
        raise RenderError(f"no video stream in {path}")
    fmt = data.get("format", {})
    dur = None
    for cand in (fmt.get("duration"), v.get("duration")):
        try:
            if cand is not None:
                dur = float(cand)
                break
        except ValueError:
            pass
    fps = _parse_rate(v.get("avg_frame_rate")) or _parse_rate(v.get("r_frame_rate"))
    return {"width": int(v["width"]), "height": int(v["height"]),
            "duration": float(dur or 0.0), "fps": float(fps)}
