"""Fase 3: utilidades puras/compartidas de clips en vivo (URLs, segmentos, ventanas, cortes)."""
from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .config import get_settings

log = logging.getLogger("snip.live")

SEGMENT_PREFIX = "seg_"
SEGMENT_FMT = "%Y%m%dT%H%M%S"
SEGMENT_RE = re.compile(r"^seg_(\d{8}T\d{6})\.ts$")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# ------------------------------------------------------------ ajustes (env)
def _num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def get_buffer_min() -> float:
    return max(1.0, _num("SNIP_LIVE_BUFFER_MIN", 15))


def get_delay_s() -> float:
    return max(0.0, _num("SNIP_LIVE_DELAY_S", 8))


def get_segment_s() -> int:
    return max(2, int(_num("SNIP_LIVE_SEGMENT_S", 6)))


def get_quality() -> str:
    return os.environ.get("SNIP_LIVE_QUALITY", "").strip() or "720p60,720p,best"


def live_root() -> Path:
    return get_settings().data_dir / "live"


def watch_dir(watch_id: str) -> Path:
    return live_root() / str(watch_id)


# ------------------------------------------------------------ URLs
@dataclass(frozen=True)
class LiveTarget:
    url: str  # URL canónica
    platform: str  # youtube | kick | twitch | other
    channel: str | None
    key: str  # clave de comparación: "kick:westcol"


_YT_ID = re.compile(r"^[\w-]{6,}$")


def normalize_live_url(raw: str) -> LiveTarget:
    """Normaliza un enlace de canal en vivo. Lanza ValueError si no es una URL."""
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("URL vacía")
    if "://" not in raw:
        raw = "https://" + raw
    u = urlparse(raw)
    host = (u.hostname or "").lower()
    if not host:
        raise ValueError(f"URL inválida: {raw}")
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("m."):
        host = host[2:]
    parts = [p for p in u.path.split("/") if p]

    if host == "kick.com" or host.endswith(".kick.com"):
        ch = parts[0].lower() if parts else None
        if ch in (None, "video", "videos", "categories", "browse"):
            ch = None
        if ch:
            return LiveTarget(f"https://kick.com/{ch}", "kick", ch, f"kick:{ch}")
    elif host in ("twitch.tv", "twitch.com") or host.endswith(".twitch.tv"):
        ch = parts[0].lower() if parts else None
        if ch in ("videos", "directory", "clip", "settings") or host.startswith("clips."):
            ch = None
        if ch:
            return LiveTarget(f"https://twitch.tv/{ch}", "twitch", ch, f"twitch:{ch}")
    elif host in ("youtube.com", "youtu.be", "youtube-nocookie.com") or host.endswith(".youtube.com"):
        vid = None
        if host == "youtu.be" and parts:
            vid = parts[0]
        else:
            vid = parse_qs(u.query).get("v", [None])[0]
            if not vid and len(parts) >= 2 and parts[0] in ("live", "embed", "shorts", "v"):
                vid = parts[1]
        if vid and _YT_ID.match(vid):
            return LiveTarget(f"https://www.youtube.com/watch?v={vid}", "youtube", vid, f"youtube:{vid}")
        if parts and parts[0].startswith("@"):
            h = parts[0].lower()
            return LiveTarget(f"https://www.youtube.com/{h}/live", "youtube", h, f"youtube:{h}")
        if len(parts) >= 2 and parts[0] in ("channel", "c", "user"):
            c = f"{parts[0]}/{parts[1]}"
            return LiveTarget(f"https://www.youtube.com/{c}/live", "youtube", parts[1], f"youtube:{c.lower()}")
    # genérico: host + ruta sin barra final
    path = "/" + "/".join(parts) if parts else ""
    url = f"https://{host}{path}"
    return LiveTarget(url, "other", parts[0] if parts else host, f"other:{host}{path.lower()}")


# ------------------------------------------------------------ segmentos
def segment_name(dt: datetime) -> str:
    return SEGMENT_PREFIX + dt.astimezone(timezone.utc).strftime(SEGMENT_FMT) + ".ts"


def segment_pattern() -> str:
    """Patrón strftime de ffmpeg (la hora es UTC porque el proceso se lanza con TZ=UTC0)."""
    return SEGMENT_PREFIX + "%Y%m%dT%H%M%S.ts"


def parse_segment_time(name: str) -> datetime | None:
    m = SEGMENT_RE.match(Path(name).name)
    if not m:
        return None
    return datetime.strptime(m.group(1), SEGMENT_FMT).replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class Segment:
    start: datetime
    path: Path


def list_segments(directory: Path) -> list[Segment]:
    out: list[Segment] = []
    try:
        for p in directory.iterdir():
            t = parse_segment_time(p.name)
            if t is not None:
                out.append(Segment(t, p))
    except FileNotFoundError:
        return []
    out.sort(key=lambda s: s.start)
    return out


def segment_end(segs: list[Segment], i: int, last_end: datetime | None, nominal_s: float) -> datetime:
    """Fin estimado del segmento i: inicio del siguiente (acotado) o last_end para el último."""
    from datetime import timedelta

    cap = segs[i].start + timedelta(seconds=nominal_s * 3)
    if i + 1 < len(segs):
        return min(segs[i + 1].start, cap)
    if last_end is not None:
        return max(segs[i].start, min(last_end, cap))
    return segs[i].start + timedelta(seconds=nominal_s)


def select_segments(
    segs: list[Segment], win_start: datetime, win_end: datetime,
    last_end: datetime | None = None, nominal_s: float = 6.0,
) -> list[Segment]:
    """Segmentos que se solapan con [win_start, win_end]."""
    chosen = []
    for i, s in enumerate(segs):
        e = segment_end(segs, i, last_end, nominal_s)
        if e > win_start and s.start < win_end:
            chosen.append(s)
    return chosen


def prune_segments(directory: Path, buffer_min: float, now: datetime | None = None) -> int:
    """Borra segmentos más viejos que el búfer. Devuelve cuántos borró."""
    now = now or datetime.now(timezone.utc)
    removed = 0
    for s in list_segments(directory):
        if (now - s.start).total_seconds() > buffer_min * 60:
            try:
                s.path.unlink()
                removed += 1
            except OSError:
                pass  # en uso (Windows); se borra en la próxima vuelta
    return removed


def buffer_seconds(segs: list[Segment], now: datetime | None = None) -> float:
    if not segs:
        return 0.0
    now = now or datetime.now(timezone.utc)
    return max(0.0, (now - segs[0].start).total_seconds())


# ------------------------------------------------------------ procesos
def streamlink_cmd() -> list[str]:
    exe = Path(sys.executable).parent / ("streamlink.exe" if os.name == "nt" else "streamlink")
    if exe.exists():
        return [str(exe)]
    found = shutil.which("streamlink")
    if found:
        return [found]
    return [sys.executable, "-m", "streamlink_cli"]


def streamlink_available() -> bool:
    cmd = streamlink_cmd()
    return len(cmd) == 1 or _module_ok("streamlink_cli")


def _module_ok(name: str) -> bool:
    import importlib.util

    return importlib.util.find_spec(name) is not None


def kill_tree(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True,
                           creationflags=NO_WINDOW, timeout=10)
        else:
            import signal

            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    try:
        proc.wait(timeout=5)
    except Exception:
        pass


def popen_kwargs() -> dict:
    if os.name == "nt":
        return {"creationflags": NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


# ------------------------------------------------------------ corte por hora de reloj
def probe_duration(path: Path) -> float | None:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=30, creationflags=NO_WINDOW)
        return float(r.stdout.strip())
    except Exception:
        return None


@dataclass
class CutResult:
    start: datetime  # inicio real cubierto
    end: datetime
    duration_s: float
    short_by_s: float  # cuánto faltó respecto a lo pedido
    video: Path
    wav: Path


def cut_window(directory: Path, win_start: datetime, win_end: datetime, out_dir: Path,
               nominal_s: float | None = None) -> CutResult:
    """Corta [win_start, win_end] (UTC) del búfer a out_dir/source.mp4 + audio.wav (16 kHz mono)."""
    from datetime import timedelta

    nominal = nominal_s or get_segment_s()
    segs = list_segments(directory)
    if not segs:
        raise RuntimeError("El búfer está vacío (todavía no hay segmentos grabados).")
    last_dur = probe_duration(segs[-1].path)
    last_end = segs[-1].start + timedelta(seconds=last_dur) if last_dur else None
    chosen = select_segments(segs, win_start, win_end, last_end, nominal)
    if not chosen:
        raise RuntimeError("El búfer no cubre ese momento (ya se borró o aún no se grabó).")
    first_start = chosen[0].start
    last_i = segs.index(chosen[-1])
    avail_end = segment_end(segs, last_i, last_end, nominal)
    eff_start = max(win_start, first_start)
    eff_end = min(win_end, avail_end)
    dur = (eff_end - eff_start).total_seconds()
    if dur < 2:
        raise RuntimeError("El búfer solo cubre menos de 2 s del tramo pedido.")
    offset = (eff_start - first_start).total_seconds()

    out_dir.mkdir(parents=True, exist_ok=True)
    listing = out_dir / "concat.txt"
    listing.write_text(
        "".join("file '{}'\n".format(str(s.path.resolve()).replace("\\", "/").replace("'", "'\\''")) for s in chosen),
        encoding="utf-8")
    video = out_dir / "source.mp4"
    wav = out_dir / "audio.wav"
    tmp = out_dir / "source.part.mp4"
    base = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    r = subprocess.run(
        base + ["-f", "concat", "-safe", "0", "-i", str(listing), "-ss", f"{offset:.3f}", "-t", f"{dur:.3f}",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-f", "mp4", str(tmp)],
        capture_output=True, text=True, creationflags=NO_WINDOW)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg no pudo cortar el búfer: {r.stderr.strip()[-600:]}")
    tmp.replace(video)
    r = subprocess.run(base + ["-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
                       capture_output=True, text=True, creationflags=NO_WINDOW)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg no pudo extraer el audio: {r.stderr.strip()[-600:]}")
    real = probe_duration(video) or dur
    want = (win_end - win_start).total_seconds()
    return CutResult(eff_start, eff_end, real, max(0.0, want - dur), video, wav)
