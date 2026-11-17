import os
import subprocess
from datetime import datetime, timedelta, timezone

import pytest

from snip_worker import live_utils as lu


# ---------------- URLs
@pytest.mark.parametrize("raw,key,url", [
    ("https://Kick.com/WestCol/", "kick:westcol", "https://kick.com/westcol"),
    ("kick.com/westcol?x=1", "kick:westcol", "https://kick.com/westcol"),
    ("https://www.twitch.tv/Ibai", "twitch:ibai", "https://twitch.tv/ibai"),
    ("https://m.twitch.tv/ibai/", "twitch:ibai", "https://twitch.tv/ibai"),
    ("https://www.youtube.com/watch?v=abcDEF12345&t=3", "youtube:abcDEF12345",
     "https://www.youtube.com/watch?v=abcDEF12345"),
    ("https://youtu.be/abcDEF12345", "youtube:abcDEF12345", "https://www.youtube.com/watch?v=abcDEF12345"),
    ("https://www.youtube.com/live/abcDEF12345", "youtube:abcDEF12345",
     "https://www.youtube.com/watch?v=abcDEF12345"),
    ("https://www.youtube.com/@Canal/live", "youtube:@canal", "https://www.youtube.com/@canal/live"),
])
def test_normalize(raw, key, url):
    t = lu.normalize_live_url(raw)
    assert t.key == key and t.url == url


def test_normalize_platforms_and_errors():
    assert lu.normalize_live_url("https://kick.com/x").platform == "kick"
    assert lu.normalize_live_url("https://twitch.tv/x").channel == "x"
    assert lu.normalize_live_url("https://example.com/a/").url == "https://example.com/a"
    with pytest.raises(ValueError):
        lu.normalize_live_url("  ")


# ---------------- segmentos
def test_segment_name_roundtrip():
    dt = datetime(2026, 5, 3, 14, 7, 9, tzinfo=timezone.utc)
    name = lu.segment_name(dt)
    assert name == "seg_20260503T140709.ts"
    assert lu.parse_segment_time(name) == dt
    assert lu.parse_segment_time("otro.ts") is None


def _fake(tmp_path, base, n, step=6):
    for i in range(n):
        (tmp_path / lu.segment_name(base + timedelta(seconds=i * step))).write_bytes(b"x")
    return lu.list_segments(tmp_path)


def test_select_segments(tmp_path):
    base = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    segs = _fake(tmp_path, base, 10)  # 0..60 s
    last_end = base + timedelta(seconds=60)
    sel = lu.select_segments(segs, base + timedelta(seconds=13), base + timedelta(seconds=25), last_end)
    assert [s.start for s in sel] == [base + timedelta(seconds=t) for t in (12, 18, 24)]
    # fuera de rango
    assert lu.select_segments(segs, base + timedelta(seconds=100), base + timedelta(seconds=110), last_end) == []
    # parcialmente antes del búfer
    sel = lu.select_segments(segs, base - timedelta(seconds=20), base + timedelta(seconds=7), last_end)
    assert len(sel) == 2


def test_prune_and_buffer(tmp_path):
    now = datetime(2026, 1, 1, 12, 20, 0, tzinfo=timezone.utc)
    base = now - timedelta(minutes=20)
    _fake(tmp_path, base, 200)  # 20 min
    removed = lu.prune_segments(tmp_path, 15, now)
    left = lu.list_segments(tmp_path)
    assert removed > 0
    assert (now - left[0].start).total_seconds() <= 15 * 60
    assert 14 * 60 <= lu.buffer_seconds(left, now) <= 15 * 60


# ---------------- integración con ffmpeg real
def _ffmpeg_segments(tmp_path, base, total_s=24, seg_s=4):
    """Genera un video con un contador de tiempo y lo parte en segmentos con hora de reloj fija."""
    src = tmp_path / "src.ts"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", f"testsrc=size=320x180:rate=25:duration={total_s}",
                    "-f", "lavfi", "-i", f"sine=frequency=440:duration={total_s}",
                    "-c:v", "libx264", "-g", str(25 * seg_s), "-keyint_min", str(25 * seg_s),
                    "-sc_threshold", "0", "-c:a", "aac", "-shortest", str(src)], check=True)
    segdir = tmp_path / "live"
    segdir.mkdir()
    tmpl = tmp_path / "part_%03d.ts"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-c", "copy",
                    "-f", "segment", "-segment_time", str(seg_s), "-reset_timestamps", "1", str(tmpl)], check=True)
    parts = sorted(tmp_path.glob("part_*.ts"))
    for i, p in enumerate(parts):
        p.rename(segdir / lu.segment_name(base + timedelta(seconds=i * seg_s)))
    return segdir, len(parts)


def test_cut_window_by_wallclock(tmp_path):
    base = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    segdir, n = _ffmpeg_segments(tmp_path, base)
    assert n >= 5
    out = tmp_path / "out"
    res = lu.cut_window(segdir, base + timedelta(seconds=6), base + timedelta(seconds=16), out, nominal_s=4)
    assert res.video.exists() and res.wav.exists()
    assert abs(res.duration_s - 10) < 0.5
    assert res.short_by_s == 0
    # pide más de lo que hay: se acorta y se informa
    res2 = lu.cut_window(segdir, base + timedelta(seconds=15), base + timedelta(seconds=40), tmp_path / "out2",
                         nominal_s=4)
    assert res2.short_by_s > 5
    assert res2.duration_s < 10
    with pytest.raises(RuntimeError):
        lu.cut_window(segdir, base + timedelta(seconds=500), base + timedelta(seconds=520), tmp_path / "out3",
                      nominal_s=4)


def test_ffmpeg_strftime_utc(tmp_path):
    """El patrón strftime con TZ=UTC0 nombra los segmentos con hora UTC."""
    env = dict(os.environ, TZ="UTC0")
    before = datetime.now(timezone.utc).replace(microsecond=0)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "testsrc=size=160x120:rate=10:duration=2", "-c:v", "libx264", "-f", "segment",
                    "-segment_time", "1", "-reset_timestamps", "1", "-strftime", "1",
                    str(tmp_path / lu.segment_pattern())], check=True, env=env)
    segs = lu.list_segments(tmp_path)
    assert segs
    assert abs((segs[0].start - before).total_seconds()) < 5
