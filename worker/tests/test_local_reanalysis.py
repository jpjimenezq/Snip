"""Re-análisis (force_analysis), modo local (puro), selector heurístico y logging."""
import logging
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from snip_worker import heuristic, jobs, local
from snip_worker.logsetup import DailyFileHandler
from tests.test_snip import make_segments


class FakeDb:
    def __init__(self, clips):
        self.clips = {c["id"]: dict(c) for c in clips}
        self.deleted = []
        self.created = []
        self.statuses = []

    def get_source(self, sid):
        return {"id": sid, "user_id": "u", "url": "http://x", "title": "t", "duration_s": 200}

    def set_source_status(self, sid, status, progress=0.0, error=None):
        self.statuses.append(status)

    def update_source(self, sid, **f):
        pass

    def source_progress(self, sid):
        return lambda v: None

    def upload_file(self, *a, **k):
        pass

    def thumb_key(self, sid):
        return "k"

    def get_transcript(self, sid):
        return {"segments": make_segments(200)}

    def list_clips(self, sid):
        return list(self.clips.values())

    def delete_clip(self, cid):
        self.deleted.append(cid)
        self.clips.pop(cid)


@pytest.fixture
def fake(monkeypatch):
    clips = [
        {"id": "a", "origin": "ai", "status": "suggested"},
        {"id": "b", "origin": "ai", "status": "rendered"},
        {"id": "c", "origin": "manual", "status": "suggested"},
        {"id": "d", "origin": "hotkey", "status": "suggested"},
        {"id": "e", "origin": "ai", "status": "suggested"},
    ]
    f = FakeDb(clips)
    monkeypatch.setattr(jobs, "db", f)
    monkeypatch.setattr(jobs.ingest, "ingest", lambda s, p: {
        "platform": "other", "title": "t", "channel": None, "duration": 200.0,
        "video_path": "v.mp4", "audio_path": "a.wav", "thumb_path": "t.jpg"})
    calls = []
    monkeypatch.setattr(jobs.analyze, "find_moments", lambda *a, **k: calls.append(1) or [
        {"start_s": 10, "end_s": 40, "title": "x", "hook": "h", "reason": "r", "score": 80}])
    monkeypatch.setattr(jobs, "_create_clip", lambda *a, **k: f.created.append(a[2]) or "new")
    return f, calls


def test_force_analysis_deletes_only_suggested_ai(fake):
    f, calls = fake
    jobs.process_source({"payload": {"source_id": "s", "force_analysis": True}})
    assert sorted(f.deleted) == ["a", "e"]
    assert set(f.clips) == {"b", "c", "d"}
    assert len(calls) == 1 and f.created == [10]
    assert f.statuses[-1] == "ready"


def test_without_force_existing_ai_clips_skip_analysis(fake):
    f, calls = fake
    jobs.process_source({"payload": {"source_id": "s"}})
    assert f.deleted == [] and calls == [] and f.created == []


# ---------------------------------------------------------------- modo local
def test_parse_time():
    assert local.parse_time("90") == 90
    assert local.parse_time("1:30") == 90
    assert local.parse_time("1:02:03") == 3723
    assert local.parse_time(None) is None
    with pytest.raises(ValueError):
        local.parse_time("abc")


def test_parse_regions_and_layout():
    assert local.parse_regions("0,0,0.5,1;0.5,0,0.5,1")[1]["x"] == 0.5
    with pytest.raises(ValueError):
        local.parse_regions("1,2")
    lay = local.build_layout("split", True, True, None)
    assert lay["preset"] == "split" and len(lay["regions"]) == 2 and lay["track_face"] and lay["auto_zoom"]
    assert local.build_layout("fill", False, False, None)["regions"][0]["w"] == 0.316
    assert "regions" not in local.build_layout("fit_blur", False, False, None)


def test_slug():
    assert local.make_slug("https://www.youtube.com/watch?v=fP1VINVX7Nc") == "yt-fP1VINVX7Nc"
    assert local.make_slug("C:/videos/Mi Clip.mp4") == "Mi-Clip"


def test_offset_and_clamp():
    segs = local.offset_segments(make_segments(20), 100)
    assert segs[0]["start"] == 100 and segs[0]["words"][0]["start"] == 100
    ms = [{"start_s": 90, "end_s": 120, "x": 1}, {"start_s": 300, "end_s": 330}]
    out = local.clamp_moments(ms, 100, 200)
    assert len(out) == 1 and out[0]["start_s"] == 100


def test_heuristic_prefers_loud_dense_window():
    segs = make_segments(120, wps=2.0)
    # volumen plano -50 dB salvo un pico fuerte en 60-65 s
    db = [-50.0] * 1200
    for i in range(600, 650):
        db[i] = -15.0
    ms = heuristic.pick_moments(segs, db, 0, 120, max_clips=2, clip_s=30)
    assert 1 <= len(ms) <= 2
    best = max(ms, key=lambda m: m["score"])
    assert best["start_s"] <= 60 and best["end_s"] >= 65
    assert all(m["reason"].startswith("sin IA") for m in ms)
    if len(ms) == 2:
        assert ms[0]["end_s"] <= ms[1]["start_s"]
    assert heuristic.pick_moments([], db, 0, 120) == []


# ---------------------------------------------------------------- logging
def test_daily_file_handler(tmp_path):
    h = DailyFileHandler(tmp_path / "logs", keep_days=14)
    old = tmp_path / "logs" / "worker-20200101.log"
    old.write_text("x")
    import os
    t = (datetime.now() - timedelta(days=30)).timestamp()
    os.utime(old, (t, t))
    lg = logging.getLogger("snip.test_daily")
    lg.addHandler(h)
    lg.setLevel(logging.INFO)
    lg.info("hola ñandú")
    h.close()
    lg.removeHandler(h)
    today = h.path_for(datetime.now().date())
    assert "hola ñandú" in today.read_text(encoding="utf-8")
    assert not old.exists()
