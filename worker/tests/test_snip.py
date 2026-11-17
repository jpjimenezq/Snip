from types import SimpleNamespace

import pytest

from snip_worker import analyze, copies
from snip_worker.clipmath import manual_range, manual_title
from snip_worker.config import load_settings
from snip_worker.db import ProgressReporter
from snip_worker.ingest import detect_platform
from snip_worker.transcript_utils import (
    build_lines, chunk_lines, fmt_ts, format_lines, text_in_range, words_in_range,
)


def make_segments(total_s=200, wps=2.0):
    """Palabras de 0.5 s cada una, un segmento por cada 10 s."""
    segs = []
    t = 0.0
    n = 0
    while t < total_s:
        words = []
        seg_start = t
        for _ in range(int(10 * wps)):
            words.append({"start": round(t, 3), "end": round(t + 0.5, 3), "word": f"p{n}"})
            t += 0.5
            n += 1
        segs.append({"start": seg_start, "end": t, "text": " ".join(w["word"] for w in words), "words": words})
    return segs


# ---------- timestamps / líneas ----------
def test_fmt_ts():
    assert fmt_ts(0) == "00:00:00"
    assert fmt_ts(723.9) == "00:12:03"
    assert fmt_ts(3 * 3600 + 5) == "03:00:05"


def test_build_lines_groups_5_to_10_seconds():
    lines = build_lines(make_segments(60))
    assert 5 <= len(lines) <= 12
    starts = [t for t, _ in lines]
    assert starts == sorted(starts)
    gaps = [b - a for a, b in zip(starts, starts[1:])]
    assert all(g <= 10.5 for g in gaps)
    out = format_lines(lines)
    assert out[0].startswith("[00:00:00] p0")
    assert out[1].startswith("[00:00:")


def test_build_lines_splits_on_gap_and_sentence():
    segs = [{"start": 0, "end": 7, "text": "", "words": [
        {"start": 0, "end": 1, "word": "hola"},
        {"start": 1, "end": 6, "word": "mundo."},
        {"start": 6, "end": 7, "word": "nuevo"},
        {"start": 20, "end": 21, "word": "tarde"},
    ]}]
    lines = build_lines(segs)
    assert [t for t, _ in lines] == [0, 6, 20]


def test_chunk_lines_overlap():
    lines = [(float(i * 6), "palabra " * 40) for i in range(2000)]
    assert len(chunk_lines(lines, max_tokens=10_000_000)) == 1
    chunks = chunk_lines(lines, max_tokens=20_000, overlap_s=120)
    assert len(chunks) > 1
    assert chunks[0][-1][0] > chunks[1][0][0]  # solape
    covered = {t for c in chunks for t, _ in c}
    assert covered == {t for t, _ in lines}


def test_words_and_text_in_range():
    segs = make_segments(30)
    ws = words_in_range(segs, 5.0, 7.0)
    assert ws and all(5.0 <= (w["start"] + w["end"]) / 2 <= 7.0 for w in ws)
    assert text_in_range(segs, 0, 1.5) == "p0 p1 p2"


# ---------- snapping / solapes ----------
def test_snap_to_word_boundaries_and_duration_limits():
    segs = make_segments(300)
    m = analyze.Moment(start_s=20.2, end_s=44.9, title="a", hook="h", reason="r", score=80)
    out = analyze.snap_moments([m], segs, 300)[0]
    assert out["start_s"] == 20.0 and out["end_s"] == 45.0

    long = analyze.Moment(start_s=10, end_s=200, title="largo", hook="", reason="", score=50)
    out = analyze.snap_moments([long], segs, 300)[0]
    assert out["end_s"] - out["start_s"] <= 90

    short = analyze.Moment(start_s=100, end_s=105, title="corto", hook="", reason="", score=50)
    out = analyze.snap_moments([short], segs, 300)[0]
    assert out["end_s"] - out["start_s"] >= 15


def test_snap_clamps_to_duration():
    segs = make_segments(100)
    m = analyze.Moment(start_s=90, end_s=150, title="x", hook="", reason="", score=10)
    out = analyze.snap_moments([m], segs, 100)[0]
    assert out["end_s"] <= 100 and out["start_s"] >= 0
    assert out["end_s"] - out["start_s"] >= 15


def test_overlap_removal_keeps_higher_score():
    segs = make_segments(300)
    ms = [
        analyze.Moment(start_s=10, end_s=50, title="bajo", hook="", reason="", score=60),
        analyze.Moment(start_s=30, end_s=70, title="alto", hook="", reason="", score=90),
        analyze.Moment(start_s=100, end_s=130, title="otro", hook="", reason="", score=70),
    ]
    out = analyze.snap_moments(ms, segs, 300)
    assert [m["title"] for m in out] == ["alto", "otro"]


def test_score_clamped():
    segs = make_segments(100)
    m = {"start_s": 10, "end_s": 40, "title": "t", "hook": "h", "reason": "r", "score": 250}
    assert analyze.snap_moments([m], segs, 100)[0]["score"] == 100


# ---------- plataforma ----------
@pytest.mark.parametrize("url,expected", [
    ("https://www.youtube.com/watch?v=abc", "youtube"),
    ("https://youtu.be/abc", "youtube"),
    ("https://m.youtube.com/live/abc", "youtube"),
    ("https://kick.com/westcol/videos/123", "kick"),
    ("https://www.twitch.tv/videos/123", "twitch"),
    ("https://clips.twitch.tv/abc", "twitch"),
    ("https://example.com/video.mp4", "other"),
    ("https://notyoutube.com/x", "other"),
])
def test_detect_platform(url, expected):
    assert detect_platform(url) == expected


# ---------- clip manual ----------
def test_manual_range():
    assert manual_range(120, 30, 3600) == (90, 120)
    assert manual_range(10, 30, 3600) == (0, 10)
    assert manual_range(5000, 30, 3600) == (3570, 3600)
    s, e = manual_range(0, 30, 3600)
    assert s == 0 and e == 30


def test_manual_title():
    segs = make_segments(60)
    assert manual_title(segs, 0, 10).endswith("…")
    assert manual_title([], 65, 90) == "Clip manual 00:01:05"


# ---------- respuestas mockeadas de Claude ----------
def fake_resp(parsed=None, stop="end_turn", details=None):
    return SimpleNamespace(stop_reason=stop, parsed_output=parsed, stop_details=details)


def test_extract_parsed_ok():
    ml = analyze.MomentList(moments=[])
    assert analyze.extract_parsed(fake_resp(ml), "x") is ml


def test_extract_parsed_refusal():
    d = SimpleNamespace(category="cyber", explanation="no")
    with pytest.raises(analyze.AnalysisRefused):
        analyze.extract_parsed(fake_resp(None, "refusal", d), "análisis")


def test_extract_parsed_max_tokens_and_empty():
    with pytest.raises(RuntimeError):
        analyze.extract_parsed(fake_resp(None, "max_tokens"), "x")
    with pytest.raises(RuntimeError):
        analyze.extract_parsed(fake_resp(None), "x")


class FakeMessages:
    def __init__(self, parsed):
        self.parsed = parsed
        self.calls = []

    def parse(self, **kw):
        self.calls.append(kw)
        return fake_resp(self.parsed)


class FakeClient:
    def __init__(self, parsed):
        self.messages = FakeMessages(parsed)
        self.beta = SimpleNamespace(messages=FakeMessages(parsed))


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("SNIP_DATA_DIR", str(tmp_path))
    import snip_worker.config as cfg
    monkeypatch.setattr(cfg, "_settings", None)
    yield


def test_find_moments_with_mock_client(env):
    segs = make_segments(300)
    ml = analyze.MomentList(moments=[
        analyze.Moment(start_s=20.1, end_s=50, title="uno", hook="h", reason="r", score=88),
        analyze.Moment(start_s=25, end_s=55, title="solapado", hook="h", reason="r", score=40),
    ])
    client = FakeClient(ml)
    out = analyze.find_moments(segs, 300, client=client)
    assert [m["title"] for m in out] == ["uno"]
    call = client.beta.messages.calls[0]  # el análisis usa la beta con fallbacks
    assert call["fallbacks"] == "default"
    assert call["output_format"] is analyze.MomentList
    assert "[00:00:00]" in call["messages"][0]["content"]


def test_generate_copies_with_mock_client(env):
    parsed = copies.Copies(
        youtube=copies.YoutubeCopy(title=" T ", description="d", tags=["#a", "b"]),
        tiktok=copies.CaptionCopy(caption="c", hashtags=["fyp", "#fyp", "# kick"]),
        instagram=copies.CaptionCopy(caption="c", hashtags=["#x"]),
        facebook=copies.FacebookCopy(caption="f"),
    )
    client = FakeClient(parsed)
    out = copies.generate_copies("hola parce", "Titulo", "Westcol", client=client)
    assert out["youtube"] == {"title": "T", "description": "d", "tags": ["a", "b"]}
    assert out["tiktok"]["hashtags"] == ["#fyp", "#kick"]
    assert set(out) == {"youtube", "tiktok", "instagram", "facebook"}
    call = client.messages.calls[0]  # Haiku: sin fallbacks
    assert "fallbacks" not in call
    assert "Westcol" in call["messages"][0]["content"]


# ---------- misc ----------
def test_progress_throttle():
    writes = []
    p = ProgressReporter(writes.append, interval=3600)
    p(0.1)
    p(0.2)
    p(0.3)
    assert writes == [0.1]
    p(1.0, force=True)
    assert writes == [0.1, 1.0]


def test_settings_defaults(monkeypatch, tmp_path):
    for k in ("SNIP_ANALYSIS_MODEL", "SNIP_COPY_MODEL", "WHISPER_MODEL", "SNIP_POLL_SECONDS"):
        monkeypatch.delenv(k, raising=False)
    s = load_settings(tmp_path / "nope.env")
    assert s.analysis_model == "claude-sonnet-5-5"
    assert s.copy_model == "claude-haiku-5-5"
    assert s.whisper_model == "large-v3-turbo"
    assert s.poll_seconds == 3
