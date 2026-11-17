"""Thin subprocess runner around ffmpeg/ffprobe with -progress parsing."""
from __future__ import annotations

import collections
import subprocess
import threading
import time
from typing import Callable, Sequence

from .errors import RenderError

_STDERR_TAIL_LINES = 40


def _tail_text(lines) -> str:
    return "\n".join(lines).strip()[-3000:]


def run_ffmpeg(
    args: Sequence[str],
    duration: float | None = None,
    on_progress: Callable[[float], None] | None = None,
    cwd: str | None = None,
) -> None:
    """Run ffmpeg with `args` (without the binary name). Raises RenderError on failure."""
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
           "-progress", "pipe:1", "-nostats", *args]
    try:
        proc = subprocess.Popen(
            cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
        )
    except FileNotFoundError as e:
        raise RenderError("ffmpeg not found on PATH") from e

    tail: collections.deque[str] = collections.deque(maxlen=_STDERR_TAIL_LINES)

    def _drain():
        for line in proc.stderr:  # type: ignore[union-attr]
            tail.append(line.rstrip())

    t = threading.Thread(target=_drain, daemon=True)
    t.start()

    last_emit = 0.0
    last_val = -1.0
    assert proc.stdout is not None
    for line in proc.stdout:
        if not on_progress or not duration or duration <= 0:
            continue
        key, _, val = line.strip().partition("=")
        if key in ("out_time_us", "out_time_ms"):  # both are microseconds in practice
            try:
                sec = int(val) / 1_000_000
            except ValueError:
                continue
            frac = max(0.0, min(1.0, sec / duration))
            now = time.monotonic()
            if frac - last_val >= 0.005 and now - last_emit >= 0.25:
                last_emit, last_val = now, frac
                try:
                    on_progress(frac)
                except Exception:
                    pass
    rc = proc.wait()
    t.join(timeout=5)
    if rc != 0:
        raise RenderError(f"ffmpeg exited with code {rc}:\n{_tail_text(tail)}")
    if on_progress:
        try:
            on_progress(1.0)
        except Exception:
            pass


def run_ffprobe(args: Sequence[str]) -> str:
    try:
        r = subprocess.run(["ffprobe", "-hide_banner", "-v", "error", *args],
                           capture_output=True, stdin=subprocess.DEVNULL, text=True,
                           encoding="utf-8", errors="replace")
    except FileNotFoundError as e:
        raise RenderError("ffprobe not found on PATH") from e
    if r.returncode != 0:
        raise RenderError(f"ffprobe failed ({r.returncode}): {r.stderr.strip()[-1500:]}")
    return r.stdout
