"""Face tracking: detection on low-res sampled frames -> smoothed crop-window trajectory.

Pure helpers (selection, smoothing, keyframes, ffmpeg expressions) are separated from the
I/O parts (ffmpeg raw frame piping, OpenCV detectors) so they can be unit tested.
"""
from __future__ import annotations

import logging
import math
import os
import subprocess
from pathlib import Path
from typing import Iterator, Sequence

from .errors import RenderError

log = logging.getLogger("snip.render.tracking")

SAMPLE_FPS = 5.0            # detection sampling rate
DETECT_MAX_W = 1280         # frames are decoded at <= this width
SEARCH_EXPAND_X = 0.40      # search area = region expanded by this fraction of its size per side
SEARCH_EXPAND_Y = 0.15
MIN_FACE_FRAC = 0.04        # ignore faces smaller than this fraction of the search area height
MIN_DETECTED_FRAC = 0.10    # fewer detections than this fraction of samples -> static fallback
KEYFRAMES_PER_S = 2.0
DEADZONE_X = 0.07           # fraction of the window size
DEADZONE_Y = 0.15
TAU_X = 0.35                # exponential smoothing time constants (s)
TAU_Y = 0.9
LOOKAHEAD_S = 0.4           # offline: the window anticipates the face by this much (cancels lag)

YUNET_URL = ("https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/"
             "face_detection_yunet_2023mar.onnx")
YUNET_NAME = "face_detection_yunet_2023mar.onnx"


# --------------------------------------------------------------------------------------
# Pure logic
# --------------------------------------------------------------------------------------

def expand_region(box: tuple[int, int, int, int], src_w: int, src_h: int,
                  ex: float = SEARCH_EXPAND_X, ey: float = SEARCH_EXPAND_Y) -> tuple[int, int, int, int]:
    """Expand a pixel box (x, y, w, h) by ex/ey of its size on each side, clamped to the frame."""
    x, y, w, h = box
    x0 = max(0, int(x - w * ex))
    y0 = max(0, int(y - h * ey))
    x1 = min(src_w, int(math.ceil(x + w * (1 + ex))))
    y1 = min(src_h, int(math.ceil(y + h * (1 + ey))))
    return x0, y0, x1 - x0, y1 - y0


def select_faces(frames: Sequence[Sequence[tuple[float, float, float, float]]]
                 ) -> list[tuple[float, float, float, float] | None]:
    """Per sample, pick one face (cx, cy, w, h) from candidates: largest wins, with a strong
    bonus for continuity with the previously chosen face (persistence)."""
    chosen: list[tuple[float, float, float, float] | None] = []
    last: tuple[float, float, float, float] | None = None
    last_age = 0
    for cands in frames:
        best, best_score = None, -1.0
        for c in cands:
            cx, cy, w, h = c
            score = w * h
            if last is not None and last_age <= 10:  # ~2 s at 5 fps
                dist = math.hypot(cx - last[0], cy - last[1])
                if dist <= max(last[2], last[3]) * 1.5:
                    score *= 3.0
            if score > best_score:
                best, best_score = c, score
        chosen.append(best)
        if best is not None:
            last, last_age = best, 0
        else:
            last_age += 1
    return chosen


def fill_gaps(values: Sequence[float | None]) -> list[float] | None:
    """Linear interpolation between known samples, hold at the ends. None if nothing known."""
    idx = [i for i, v in enumerate(values) if v is not None]
    if not idx:
        return None
    out = [0.0] * len(values)
    for i in range(len(values)):
        if values[i] is not None:
            out[i] = float(values[i])  # type: ignore[arg-type]
            continue
        left = max((j for j in idx if j < i), default=None)
        right = min((j for j in idx if j > i), default=None)
        if left is None:
            out[i] = float(values[right])  # type: ignore[arg-type]
        elif right is None:
            out[i] = float(values[left])  # type: ignore[arg-type]
        else:
            f = (i - left) / (right - left)
            out[i] = values[left] + f * (values[right] - values[left])  # type: ignore[operator]
    return out


def smooth_trajectory(times: Sequence[float], targets: Sequence[float], deadzone: float,
                      tau: float) -> list[float]:
    """Dead-zone + exponential smoothing of a 1-D target path.

    The window center only moves when the target leaves the dead-zone around it, then eases
    toward the dead-zone edge with time constant `tau` (so small face jitter is ignored)."""
    if not targets:
        return []
    out = [float(targets[0])]
    c = out[0]
    for i in range(1, len(targets)):
        dt = max(1e-3, times[i] - times[i - 1])
        off = targets[i] - c
        if abs(off) > deadzone:
            goal = targets[i] - math.copysign(deadzone, off)
            c += (goal - c) * (1.0 - math.exp(-dt / tau))
        out.append(c)
    return out


def clamp_window(center: float, size: float, limit: float) -> float:
    """Top-left coordinate of a window of `size` centered on `center`, inside [0, limit]."""
    return min(max(center - size / 2.0, 0.0), max(0.0, limit - size))


def keyframes_from_path(times: Sequence[float], xs: Sequence[float], ys: Sequence[float],
                        per_second: float = KEYFRAMES_PER_S, tol: float = 1.0
                        ) -> list[tuple[float, int, int]]:
    """Subsample a dense path to ~`per_second` keyframes (t, x, y) with integer even pixels,
    dropping keyframes that are (within `tol` px) on the line between their neighbours."""
    if not times:
        return []
    step = 1.0 / per_second
    picks = [0]
    next_t = times[0] + step
    for i in range(1, len(times) - 1):
        if times[i] >= next_t - 1e-9:
            picks.append(i)
            next_t = times[i] + step
    if len(times) > 1:
        picks.append(len(times) - 1)
    kf = [(round(times[i], 3), int(round(xs[i] / 2.0)) * 2, int(round(ys[i] / 2.0)) * 2) for i in picks]
    # drop near-collinear points
    out = [kf[0]]
    for k in range(1, len(kf) - 1):
        (t0, x0, y0), (t1, x1, y1), (t2, x2, y2) = out[-1], kf[k], kf[k + 1]
        f = (t1 - t0) / (t2 - t0) if t2 > t0 else 0.0
        if abs(x0 + f * (x2 - x0) - x1) > tol or abs(y0 + f * (y2 - y0) - y1) > tol:
            out.append(kf[k])
    if len(kf) > 1:
        out.append(kf[-1])
    return out


def _fmt(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def piecewise_expr(points: Sequence[tuple[float, float]], var: str = "t") -> str:
    """ffmpeg expression for the piecewise-linear function through (time, value) points
    (held constant before the first / after the last). Balanced `if` tree keeps nesting shallow."""
    pts = list(points)
    if not pts:
        return "0"
    if len(pts) == 1 or all(abs(p[1] - pts[0][1]) < 1e-9 for p in pts):
        return _fmt(pts[0][1])

    def seg(i: int) -> str:
        (t0, v0), (t1, v1) = pts[i], pts[i + 1]
        if t1 - t0 < 1e-6:
            return _fmt(v1)
        slope = (v1 - v0) / (t1 - t0)
        return f"({_fmt(v0)}+({_fmt(slope)})*({var}-{_fmt(t0)}))"

    def build(lo: int, hi: int) -> str:  # segments lo..hi-1 (segment i spans pts[i]..pts[i+1])
        if hi - lo == 1:
            return seg(lo)
        mid = (lo + hi) // 2
        return f"if(lt({var},{_fmt(pts[mid][0])}),{build(lo, mid)},{build(mid, hi)})"

    return f"if(lt({var},{_fmt(pts[0][0])}),{_fmt(pts[0][1])},if(gte({var},{_fmt(pts[-1][0])}),{_fmt(pts[-1][1])},{build(0, len(pts) - 1)}))"


def build_track(times: Sequence[float], faces: Sequence[tuple[float, float, float, float] | None],
                box: tuple[int, int, int, int], src_w: int, src_h: int) -> dict | None:
    """Turn per-sample chosen faces (source pixel coords) into a crop trajectory for `box`.

    Returns {"keys": [(t, x, y), ...], "face_rel_y": float} or None (static fallback)."""
    n = len(times)
    if n < 2:
        return None
    found = sum(1 for f in faces if f is not None)
    if found < max(2, int(math.ceil(n * MIN_DETECTED_FRAC))):
        return None
    bx, by, bw, bh = box
    cx_t = fill_gaps([f[0] if f else None for f in faces])
    cy_t = fill_gaps([f[1] if f else None for f in faces])
    if cx_t is None or cy_t is None:
        return None
    # The face center target for the window center. Vertical: mild, around the region's own center.
    cy_t = [bh_c * 0.35 + (by + bh / 2.0) * 0.65 for bh_c in cy_t]
    k = int(round(LOOKAHEAD_S * SAMPLE_FPS))
    cx_t = cx_t[k:] + [cx_t[-1]] * min(k, n)
    cy_t = cy_t[k:] + [cy_t[-1]] * min(k, n)
    sx = smooth_trajectory(times, cx_t, DEADZONE_X * bw, TAU_X)
    sy = smooth_trajectory(times, cy_t, DEADZONE_Y * bh, TAU_Y)
    xs = [clamp_window(c, bw, src_w) for c in sx]
    ys = [clamp_window(c, bh, src_h) for c in sy]
    keys = keyframes_from_path(times, xs, ys)
    # Face vertical position inside the output window (used to center zooms on the face)
    rels = sorted(((f[1] - ys[i]) / bh) for i, f in enumerate(faces) if f is not None)
    rel_y = rels[len(rels) // 2] if rels else 0.5
    return {"keys": keys, "face_rel_y": min(max(rel_y, 0.2), 0.7)}


def track_exprs(keys: Sequence[tuple[float, int, int]]) -> tuple[str, str]:
    """(x_expr, y_expr) for ffmpeg `crop` from keyframes."""
    return (piecewise_expr([(t, x) for t, x, _ in keys]),
            piecewise_expr([(t, y) for t, _, y in keys]))


# --------------------------------------------------------------------------------------
# Detectors
# --------------------------------------------------------------------------------------

def models_dir() -> Path:
    base = os.environ.get("SNIP_DATA_DIR") or ""
    if base:
        d = Path(base).expanduser()
    else:
        d = Path(__file__).resolve().parents[2] / "data"
    return d / "models"


def ensure_yunet_model() -> Path | None:
    """Return the YuNet ONNX path, downloading it once. None if unavailable."""
    path = models_dir() / YUNET_NAME
    if path.exists() and path.stat().st_size > 100_000:
        return path
    try:
        import urllib.request
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        with urllib.request.urlopen(YUNET_URL, timeout=30) as r, open(tmp, "wb") as f:
            f.write(r.read())
        if tmp.stat().st_size < 100_000:
            tmp.unlink(missing_ok=True)
            return None
        tmp.replace(path)
        return path
    except Exception as e:  # noqa: BLE001
        log.warning("could not download YuNet model: %s", e)
        return None


class FaceDetector:
    """Detects faces on BGR frames. YuNet when its model is available, else Haar cascade."""

    def __init__(self) -> None:
        try:
            import cv2
        except ImportError as e:
            raise RenderError("opencv-python-headless is required for track_face") from e
        self.cv2 = cv2
        self.yunet = None
        self.haar = None
        model = ensure_yunet_model()
        if model is not None and hasattr(cv2, "FaceDetectorYN"):
            try:
                self.yunet = cv2.FaceDetectorYN.create(str(model), "", (320, 320), 0.7, 0.3, 500)
            except Exception as e:  # noqa: BLE001
                log.warning("YuNet init failed: %s", e)
        if self.yunet is None:
            self.haar = cv2.CascadeClassifier(
                os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml"))
            if self.haar.empty():
                raise RenderError("no face detector available (YuNet model and Haar cascade missing)")
        self.name = "yunet" if self.yunet is not None else "haar"

    def detect(self, img) -> list[tuple[float, float, float, float]]:
        """Faces as (cx, cy, w, h) in the pixel coordinates of `img`."""
        h, w = img.shape[:2]
        out: list[tuple[float, float, float, float]] = []
        if self.yunet is not None:
            self.yunet.setInputSize((w, h))
            _, faces = self.yunet.detect(img)
            for f in (faces if faces is not None else []):
                x, y, fw, fh = (float(v) for v in f[:4])
                out.append((x + fw / 2, y + fh / 2, fw, fh))
        else:
            gray = self.cv2.cvtColor(img, self.cv2.COLOR_BGR2GRAY)
            for (x, y, fw, fh) in self.haar.detectMultiScale(gray, 1.1, 5, minSize=(24, 24)):
                out.append((x + fw / 2, y + fh / 2, float(fw), float(fh)))
        return [f for f in out if f[3] >= max(12.0, MIN_FACE_FRAC * h)]


def iter_frames(src: str, start: float, duration: float, fps: float, out_w: int, out_h: int
                ) -> Iterator[tuple[float, "object"]]:
    """Yield (t_rel, BGR ndarray HxWx3) sampled at `fps` from [start, start+duration], decoded
    by ffmpeg at out_w x out_h and streamed through a pipe (never the whole video in memory)."""
    import numpy as np
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error",
           "-ss", f"{start:.3f}", "-i", src, "-t", f"{duration:.3f}", "-an", "-sn",
           "-vf", f"fps={fps},scale={out_w}:{out_h}:flags=fast_bilinear",
           "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1"]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                stdin=subprocess.DEVNULL)
    except FileNotFoundError as e:
        raise RenderError("ffmpeg not found on PATH") from e
    size = out_w * out_h * 3
    i = 0
    try:
        assert proc.stdout is not None
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield i / fps, np.frombuffer(buf, np.uint8).reshape(out_h, out_w, 3)
            i += 1
    finally:
        try:
            proc.stdout.close()  # type: ignore[union-attr]
        except Exception:
            pass
        proc.kill()
        proc.wait()


def compute_tracks(src: str, start: float, duration: float, src_w: int, src_h: int,
                   boxes: Sequence[tuple[int, int, int, int]],
                   detector: FaceDetector | None = None,
                   expand_x: float = SEARCH_EXPAND_X) -> list[dict | None]:
    """One track (or None for static fallback) per region box (source pixels)."""
    if not boxes or duration <= 0.5:
        return [None] * len(boxes)
    det = detector or FaceDetector()
    scale = min(1.0, DETECT_MAX_W / src_w)
    fw = max(2, int(round(src_w * scale)) // 2 * 2)
    fh = max(2, int(round(src_h * scale)) // 2 * 2)
    sx, sy = src_w / fw, src_h / fh
    areas = [expand_region(b, src_w, src_h, expand_x) for b in boxes]
    times: list[float] = []
    cands: list[list[list[tuple[float, float, float, float]]]] = [[] for _ in boxes]
    for t, frame in iter_frames(src, start, duration, SAMPLE_FPS, fw, fh):
        times.append(t)
        for k, (ax, ay, aw, ah) in enumerate(areas):
            x0, y0 = int(ax / sx), int(ay / sy)
            x1, y1 = max(x0 + 2, int((ax + aw) / sx)), max(y0 + 2, int((ay + ah) / sy))
            crop = frame[y0:y1, x0:x1]
            found = det.detect(crop) if crop.size else []
            cands[k].append([((c[0] + x0) * sx, (c[1] + y0) * sy, c[2] * sx, c[3] * sy) for c in found])
    log.info("face tracking (%s): %d samples", det.name, len(times))
    return [build_track(times, select_faces(cands[k]), boxes[k], src_w, src_h)
            for k in range(len(boxes))]
