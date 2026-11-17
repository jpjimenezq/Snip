from snip_worker.render import layouts as L
from snip_worker.render import subtitles as S


def test_region_to_pixels_even_and_clamped():
    x, y, w, h = L.region_to_pixels({"x": 0.342, "y": 0, "w": 0.316, "h": 1}, 1920, 1080)
    assert (x, y, w, h) == (656, 0, 606, 1080)
    assert all(v % 2 == 0 for v in (x, y, w, h))
    # out of range gets clamped inside the frame
    x, y, w, h = L.region_to_pixels({"x": 0.9, "y": -1, "w": 0.5, "h": 3}, 1920, 1080)
    assert x + w <= 1920 and y == 0 and h == 1080 and w >= 2
    # garbage -> full frame
    assert L.region_to_pixels(None, 1920, 1080) == (0, 0, 1920, 1080)
    assert L.region_to_pixels({"x": "a", "w": float("nan")}, 1920, 1080) == (0, 0, 1920, 1080)


def test_normalize_layout_defaults():
    assert L.normalize_layout(None)["preset"] == "fill"
    assert L.normalize_layout({"preset": "weird"})["preset"] == "fill"
    n = L.normalize_layout({"preset": "split", "regions": [{"x": 0, "y": 0, "w": 0.5, "h": 0.5}], "split_ratio": 5})
    assert len(n["regions"]) == 2 and n["split_ratio"] == 0.8


def test_split_heights_even_sum():
    for r in (0.2, 0.33, 0.5, 0.61, 0.8):
        a, b = L.split_heights(r)
        assert a + b == 1920 and a % 2 == 0 and b % 2 == 0


def test_fill_graph():
    g = L.build_filtergraph(None, 1920, 1080)
    assert g.startswith("[0:v]crop=606:1080:656:0,scale=1080:1920:force_original_aspect_ratio=increase")
    assert "crop=1080:1920" in g and g.endswith("[v0]" if False else "format=yuv420p[vout]")
    assert "ass=" not in g


def test_fit_blur_graph():
    g = L.build_filtergraph({"preset": "fit_blur"}, 1920, 1080)
    assert "gblur" in g and "overlay=(W-w)/2:(H-h)/2" in g and "scale=1080:-2" in g


def test_split_graph_and_fps():
    layout = {"preset": "split", "split_ratio": 0.4,
              "regions": [{"x": 0, "y": 0, "w": 0.5, "h": 0.5}, {"x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5}]}
    g = L.build_filtergraph(layout, 1920, 1080, src_fps=60, ass_file="subs.ass")
    assert g.startswith("[0:v]fps=30[src];[src]split=2")
    assert "crop=960:540:0:0" in g and "crop=960:540:960:540" in g
    assert "vstack=inputs=2" in g and "scale=1080:768" in g and "scale=1080:1152" in g
    assert "ass=subs.ass,format=yuv420p[vout]" in g
    assert L.divider_y(layout) == 768
    assert L.divider_y(None) is None


def W(s, e, w):
    return {"start": s, "end": e, "word": w}


def test_escape_and_time():
    assert S.escape_ass("a{b}\\c") == "a\\{b\\}/c"
    assert S.fmt_time(3723.456) == "1:02:03.46"
    assert S.fmt_time(-1) == "0:00:00.00"


def test_prepare_words_shift_and_filter():
    words = [W(5, 6, "before"), W(10.0, 10.5, " hola "), W(10.5, 11, ""), W(14, 15, "late"), W(12, 12.5, "x")]
    out = S.prepare_words(words, 10.0, 12.2)
    assert [w["word"] for w in out] == ["hola", "x"]
    assert out[0]["start"] == 0.0 and abs(out[1]["start"] - 2.0) < 1e-9


def test_grouping_pause_punct_size():
    ws = [W(0, .3, "a"), W(.3, .6, "b"), W(.6, .9, "c.") , W(.9, 1.2, "d"), W(2.5, 2.8, "e"),
          W(2.8, 3, "f"), W(3, 3.2, "g"), W(3.2, 3.4, "h")]
    g = S.group_words(ws, 3, 18, 0.6)
    assert [[w["word"] for w in x] for x in g] == [["a", "b", "c."], ["d"], ["e", "f", "g"], ["h"]]


def test_karaoke_ass_highlight_and_shift():
    words = [W(100, 100.4, "hola"), W(100.4, 100.8, "{mundo}"), W(100.8, 101.2, "qué")]
    ass = S.generate_ass(words, 100, 110, "karaoke")
    assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass
    ev = [l for l in ass.splitlines() if l.startswith("Dialogue")]
    assert len(ev) == 3
    assert ev[0].startswith("Dialogue: 0,0:00:00.00,0:00:00.40,Karaoke")
    assert "HOLA" in ev[0] and "\\{MUNDO\\}" in ev[1] and "QUÉ" in ev[2]
    # exactly one highlighted word per event
    assert all(e.count(S.HIGHLIGHT) == 1 for e in ev)
    assert "\\pos" not in ev[0]


def test_simple_ass_and_split_position():
    words = [W(0, .5, "Hola"), W(.5, 1, "mundo."), W(1.1, 1.5, "Otra"), W(1.5, 2, "frase")]
    ass = S.generate_ass(words, 0, 5, "simple", divider_y=960)
    ev = [l for l in ass.splitlines() if l.startswith("Dialogue")]
    assert len(ev) == 2 and "Hola mundo." in ev[0] and "\\an5\\pos(540,960)" in ev[0]


def test_no_subtitles():
    assert S.generate_ass([W(0, 1, "x")], 0, 5, "none") is None
    assert S.generate_ass([], 0, 5, "karaoke") is None
