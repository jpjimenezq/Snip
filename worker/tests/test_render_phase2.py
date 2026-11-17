"""Phase 2: face tracking trajectory, zoom timeline/expressions and render integration."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from snip_worker.render import layouts as L
from snip_worker.render import probe, render_clip
from snip_worker.render import tracking as T
from snip_worker.render import zoom as Z


# ---------------------------------------------------------------- trajectory (pure)

def test_fill_gaps_interpolates_and_holds():
    assert T.fill_gaps([None, 1.0, None, None, 4.0, None]) == [1.0, 1.0, 2.0, 3.0, 4.0, 4.0]
    assert T.fill_gaps([None, None]) is None


def test_smooth_ignores_jitter_inside_deadzone():
    times = [i * 0.2 for i in range(30)]
    targets = [500 + (5 if i % 2 else -5) for i in range(30)]
    out = T.smooth_trajectory(times, targets, deadzone=20, tau=0.5)
    assert max(out) - min(out) < 1e-9


def test_smooth_follows_step_without_overshoot():
    times = [i * 0.2 for i in range(60)]
    targets = [100.0] * 10 + [400.0] * 50
    out = T.smooth_trajectory(times, targets, deadzone=10, tau=0.5)
    assert out[9] == 100.0
    assert all(b >= a - 1e-9 for a, b in zip(out, out[1:]))
    assert max(out) <= 400.0 and out[-1] == pytest.approx(390.0, abs=2)  # settles at dead-zone edge
    assert out[11] < 300  # eased, not a jump


def test_clamp_window():
    assert T.clamp_window(50, 600, 1920) == 0
    assert T.clamp_window(1900, 600, 1920) == 1320
    assert T.clamp_window(960, 600, 1920) == 660


def test_select_faces_prefers_large_and_persistent():
    a = (100.0, 100.0, 80.0, 80.0)
    b = (900.0, 100.0, 90.0, 90.0)   # slightly larger but far away
    frames = [[a], [a, b], [b, (102.0, 101.0, 80.0, 80.0)], [], [(105.0, 100.0, 82.0, 82.0), b]]
    out = T.select_faces(frames)
    assert out[0] == a and out[1] == a          # persistence beats a slightly bigger newcomer
    assert out[2][0] < 200 and out[3] is None and out[4][0] < 200
    assert T.select_faces([[a, (500.0, 500.0, 200.0, 200.0)]])[0][2] == 200.0  # largest when no history


def test_keyframes_subsampled_and_even():
    times = [i * 0.2 for i in range(300)]  # 60 s at 5 Hz
    xs = [100 + 300 * (1 if (i // 40) % 2 else 0) + i for i in range(300)]
    kf = T.keyframes_from_path(times, xs, [0.0] * 300)
    assert len(kf) <= 60 * T.KEYFRAMES_PER_S + 2
    assert kf[0][0] == 0.0 and kf[-1][0] == pytest.approx(59.8)
    assert all(x % 2 == 0 and y % 2 == 0 for _, x, y in kf)
    flat = T.keyframes_from_path(times, [200.0] * 300, [0.0] * 300)
    assert len(flat) == 2  # collinear points removed


def test_piecewise_expr_values():
    pts = [(0.0, 100.0), (1.0, 200.0), (2.0, 200.0), (4.0, 0.0)]
    e = T.piecewise_expr(pts)
    assert "t" in e and e.count("(") == e.count(")")
    assert T.piecewise_expr([(0, 5), (3, 5)]) == "5"
    assert T.piecewise_expr([]) == "0"
    # evaluate with python (ffmpeg's if/lt/gte mapped)
    def ev(t):
        return eval(e.replace("if(", "iff("), {"iff": lambda c, a, b: a if c else b,
                                               "lt": lambda a, b: a < b, "gte": lambda a, b: a >= b, "t": t})
    # eager evaluation of both branches is fine for pure arithmetic
    assert ev(-1) == 100 and ev(0.5) == pytest.approx(150) and ev(1.5) == pytest.approx(200)
    assert ev(3) == pytest.approx(100) and ev(10) == 0


def test_expression_length_sane_for_60s():
    times = [i * 0.2 for i in range(300)]
    xs = [600 + 500 * __import__("math").sin(i / 9) for i in range(300)]
    kf = T.keyframes_from_path(times, xs, [0.0] * 300)
    xe, ye = T.track_exprs(kf)
    assert len(xe) < 8000 and ye == "0"


def test_build_track_none_without_faces_and_clamped():
    times = [i * 0.2 for i in range(50)]
    box = (656, 0, 606, 1080)
    assert T.build_track(times, [None] * 50, box, 1920, 1080) is None
    assert T.build_track(times, [None] * 48 + [(900.0, 500.0, 100.0, 100.0)] * 2, box, 1920, 1080) is None
    faces = [(100.0 + 30 * i, 500.0, 120.0, 120.0) for i in range(50)]  # walks off to the right
    tr = T.build_track(times, faces, box, 1920, 1080)
    assert tr and all(0 <= x <= 1920 - 606 for _, x, _ in tr["keys"])
    assert all(y == 0 for _, _, y in tr["keys"])  # full-height region: no vertical room
    assert 0.2 <= tr["face_rel_y"] <= 0.7


def test_expand_region_clamped():
    assert T.expand_region((656, 0, 606, 1080), 1920, 1080, 0.4, 0.15) == (413, 0, 1092, 1080)


# ---------------------------------------------------------------- zoom (pure)

def test_sanitize_and_merge_zooms():
    man = [{"start": 4, "end": 6, "scale": 1.3}, {"start": 5, "end": 9, "scale": 9}, {"start": "x"},
           {"start": 1, "end": 1.1, "scale": 1.3}, {"start": 20, "end": 30, "scale": 1.3}]
    out = Z.sanitize_zooms(man, 12)
    assert out[0] == {"start": 4.0, "end": 6.0, "scale": 1.3}
    assert out[1]["start"] == 6.0 and out[1]["scale"] == Z.MAX_SCALE
    assert len(out) == 2

    auto = [{"start": 5.2, "end": 6.5, "scale": 1.25}, {"start": 10, "end": 11.5, "scale": 1.25}]
    merged = Z.merge_zooms([{"start": 4, "end": 6, "scale": 1.4}], auto, 12)
    assert [(z["start"], z["scale"]) for z in merged] == [(4.0, 1.4), (10.0, 1.25)]


def test_pick_zoom_moments_peaks_spaced():
    n = 300  # 30 s at 100 ms
    db = [-40.0] * n
    for c, lvl in ((50, -8), (120, -5), (150, -10), (240, -6)):
        for i in range(c, c + 8):
            db[i] = lvl
    z = Z.pick_zoom_moments(db, duration=30.0)
    starts = [m["start"] for m in z]
    assert all(b - a >= Z.AUTO_MIN_GAP_S - 0.01 for a, b in zip(starts, starts[1:]))
    assert any(11.5 < s < 12.5 for s in starts)  # strongest kept
    assert not any(14 < s < 16 for s in starts)  # -10 dB peak too close to the -5 dB one
    assert all(Z.AUTO_MIN_DUR_S - 1e-6 <= m["end"] - m["start"] <= Z.AUTO_MAX_DUR_S + 1e-6 for m in z)
    assert all(m["scale"] == Z.AUTO_SCALE for m in z)
    assert Z.pick_zoom_moments([-40.0] * 300, duration=30) == []  # flat -> nothing
    assert Z.pick_zoom_moments([-60.0] * 10 + [-50.0] * 10, duration=2) == []  # below floor


def test_zoom_expr_and_filter():
    e = Z.zoom_expr([{"start": 1.0, "end": 3.0, "scale": 1.3}])
    assert e.startswith("st(1,1);") and e.endswith("ld(1)") and "0.3*ld(0)" in e
    f = Z.zoom_filter([{"start": 1.0, "end": 3.0, "scale": 1.3}], 1080, 1920, (0.5, 0.4))
    assert "eval=frame" in f and "crop=1080:1920:x='0.5*(iw-1080)':y='0.4*(ih-1920)'" in f


def test_graph_orders_zoom_before_subtitles():
    g = L.build_filtergraph(None, 1920, 1080, 30, "subs.ass",
                            zooms=[{"start": 1, "end": 2, "scale": 1.3}])
    assert g.index("eval=frame") < g.index("ass=subs.ass")
    g2 = L.build_filtergraph(None, 1920, 1080, 30, None)
    assert "eval=frame" not in g2


def test_graph_with_tracks_uses_time_expression():
    tr = {"keys": [(0.0, 100, 0), (1.0, 300, 0), (2.0, 300, 0)]}
    g = L.build_filtergraph({"preset": "fill", "regions": [{"x": 0.1, "y": 0, "w": 0.316, "h": 1}]},
                            1920, 1080, 30, None, tracks=[tr])
    assert "crop=606:1080:x='" in g and "lt(t," in g
    gs = L.build_filtergraph({"preset": "split", "regions": []}, 1920, 1080, 30, None, tracks=[tr, None])
    assert gs.count("x='") == 1


def test_normalize_layout_phase2_fields():
    n = L.normalize_layout({"preset": "fit_blur", "track_face": True, "auto_zoom": True, "zooms": [1]})
    assert n["track_face"] is False and n["auto_zoom"] is True and n["zooms"] == [1]
    assert L.normalize_layout(None)["track_face"] is False


# ---------------------------------------------------------------- integration

def _ff(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True,
                   stdin=subprocess.DEVNULL, capture_output=True)


@pytest.fixture(scope="module")
def plain(tmp_path_factory):
    p = tmp_path_factory.mktemp("p2") / "plain.mp4"
    _ff(["-f", "lavfi", "-i", "gradients=size=1920x1080:rate=30:duration=10",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(p)])
    return str(p)


WORDS = [{"start": 1.0 + i * 0.4, "end": 1.38 + i * 0.4, "word": w} for i, w in enumerate("hola parce que mas".split())]


@pytest.mark.parametrize("preset", ["fill", "split"])
def test_track_face_falls_back_when_no_face(plain, tmp_path, preset):
    regions = ([{"x": 0.342, "y": 0, "w": 0.316, "h": 1}] if preset == "fill" else
               [{"x": 0, "y": 0, "w": 0.5, "h": 0.5}, {"x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5}])
    lay = {"preset": preset, "regions": regions, "track_face": True}
    from snip_worker.render import _plan_edits
    tracks, zooms, center = _plan_edits(plain, lay, 1.0, 6.0, probe(plain))
    assert all(t is None for t in tracks) and zooms == [] and center == (0.5, 0.5)
    out = tmp_path / "t.mp4"
    render_clip(plain, 1.0, 7.0, lay, WORDS, "karaoke", str(out), encoder="libx264")
    i = probe(str(out))
    assert (i["width"], i["height"]) == (1080, 1920) and abs(i["duration"] - 6) < 0.15


def test_tracking_error_does_not_break_render(plain, tmp_path, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("detector exploded")
    monkeypatch.setattr(T, "compute_tracks", boom)
    out = tmp_path / "e.mp4"
    render_clip(plain, 0, 3, {"preset": "fill", "track_face": True}, [], "none", str(out), encoder="libx264")
    assert probe(str(out))["height"] == 1920


@pytest.mark.parametrize("preset", ["fill", "fit_blur", "split"])
def test_zooms_render_size_and_duration(plain, tmp_path, preset):
    lay = {"preset": preset, "zooms": [{"start": 1.0, "end": 2.5, "scale": 1.4},
                                       {"start": 3.5, "end": 5.5, "scale": 1.2}], "auto_zoom": True}
    if preset == "split":
        lay["regions"] = [{"x": 0, "y": 0, "w": 0.5, "h": 0.5}, {"x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5}]
    out = tmp_path / f"z_{preset}.mp4"
    render_clip(plain, 0.5, 7.5, lay, WORDS, "karaoke", str(out), encoder="libx264")
    i = probe(str(out))
    assert (i["width"], i["height"]) == (1080, 1920) and abs(i["duration"] - 7.0) < 0.15


FACE = os.environ.get("SNIP_TEST_FACE_IMAGE", "")


@pytest.mark.skipif(not FACE or not Path(FACE).exists(), reason="set SNIP_TEST_FACE_IMAGE to a face photo")
def test_tracking_follows_moving_face(tmp_path):
    src = tmp_path / "face.mp4"
    _ff(["-f", "lavfi", "-i", "color=c=gray:size=1920x1080:rate=30:duration=8", "-loop", "1", "-framerate", "30",
         "-i", FACE, "-filter_complex",
         "[1:v]scale=300:300[f];[0:v][f]overlay=x='300+1000*(t/8)':y=300:shortest=1[v]", "-map", "[v]",
         "-t", "8", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(src)])
    tracks = T.compute_tracks(str(src), 0, 8, 1920, 1080, [(656, 0, 606, 1080)], expand_x=1.0)
    assert tracks[0] is not None
    keys = tracks[0]["keys"]
    assert keys[-1][1] - keys[0][1] > 500  # window moved right with the face
