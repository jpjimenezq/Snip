import itertools
import subprocess

import pytest

from snip_worker.render import (RenderError, extract_frame, make_preview, probe,
                                render_clip)

WORDS = [{"start": 3.0 + i * 0.4, "end": 3.0 + i * 0.4 + 0.38, "word": w}
         for i, w in enumerate("hola parce qué más, esto es un clip de prueba para subtítulos".split())]
LAYOUTS = {
    "fill": None,
    "fit_blur": {"preset": "fit_blur", "regions": []},
    "split": {"preset": "split", "split_ratio": 0.5,
              "regions": [{"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}, {"x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5}]},
}


@pytest.fixture(scope="session")
def src(tmp_path_factory):
    p = tmp_path_factory.mktemp("src") / "src.mp4"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=12",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(p)],
        check=True, stdin=subprocess.DEVNULL, capture_output=True)
    return str(p)


def test_probe(src):
    i = probe(src)
    assert (i["width"], i["height"]) == (1920, 1080)
    assert abs(i["duration"] - 12) < 0.2 and abs(i["fps"] - 30) < 0.01


def test_extract_frame(src, tmp_path):
    out = tmp_path / "sub" / "f.jpg"
    extract_frame(src, 5.5, str(out))
    assert out.stat().st_size > 5000


def test_make_preview(src, tmp_path):
    out = tmp_path / "p" / "prev.mp4"
    make_preview(src, 2, 7, str(out))
    i = probe(str(out))
    assert i["height"] == 480 and abs(i["duration"] - 5) < 0.15


@pytest.mark.parametrize("preset,style", list(itertools.product(LAYOUTS, ["karaoke", "simple", "none"])))
def test_render_clip(src, tmp_path, preset, style):
    out = tmp_path / "o" / f"{preset}_{style}.mp4"
    prog = []
    render_clip(src, 2.0, 8.0, LAYOUTS[preset], WORDS, style, str(out), encoder="libx264",
                on_progress=prog.append)
    i = probe(str(out))
    assert (i["width"], i["height"]) == (1080, 1920)
    assert abs(i["duration"] - 6.0) < 0.15
    assert prog and prog[-1] == 1.0


def test_render_error(src, tmp_path):
    with pytest.raises(RenderError):
        render_clip(src, 5, 4, None, [], "none", str(tmp_path / "x.mp4"), encoder="libx264")
    with pytest.raises(RenderError):
        render_clip(str(tmp_path / "missing.mp4"), 0, 4, None, [], "none", str(tmp_path / "x.mp4"), encoder="libx264")


def _nvenc_ok():
    try:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                            "color=c=black:s=640x360:d=0.2", "-frames:v", "1", "-c:v", "h264_nvenc",
                            "-f", "null", "-"], capture_output=True, stdin=subprocess.DEVNULL, timeout=60)
        return r.returncode == 0
    except Exception:
        return False


@pytest.mark.skipif(not _nvenc_ok(), reason="h264_nvenc unavailable")
def test_render_nvenc(src, tmp_path):
    out = tmp_path / "nv.mp4"
    render_clip(src, 1, 5, LAYOUTS["split"], WORDS, "karaoke", str(out), encoder="h264_nvenc")
    i = probe(str(out))
    assert (i["width"], i["height"]) == (1080, 1920) and abs(i["duration"] - 4) < 0.15
