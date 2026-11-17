"""Pure functions: layout dict -> pixel regions -> ffmpeg filtergraph strings."""
from __future__ import annotations

OUT_W = 1080
OUT_H = 1920

DEFAULT_LAYOUT = {"preset": "fill", "regions": [{"x": 0.342, "y": 0, "w": 0.316, "h": 1}]}
_DEFAULT_SPLIT_REGIONS = [
    {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.5},
    {"x": 0.0, "y": 0.5, "w": 1.0, "h": 0.5},
]
PRESETS = ("fill", "fit_blur", "split")


def _even_down(v: float) -> int:
    return int(v) // 2 * 2


def _num(d: dict, key: str, default: float) -> float:
    try:
        v = float(d.get(key, default))
    except (TypeError, ValueError):
        return default
    return v if v == v else default  # NaN guard


def region_to_pixels(region: dict | None, src_w: int, src_h: int) -> tuple[int, int, int, int]:
    """Normalized region -> (x, y, w, h) integer pixels, all even, inside the frame."""
    region = region if isinstance(region, dict) else {}
    x = min(max(_num(region, "x", 0.0), 0.0), 1.0)
    y = min(max(_num(region, "y", 0.0), 0.0), 1.0)
    w = _num(region, "w", 1.0)
    h = _num(region, "h", 1.0)
    w = min(max(w, 0.0), 1.0 - x)
    h = min(max(h, 0.0), 1.0 - y)
    # Convert to pixels
    px = _even_down(x * src_w)
    py = _even_down(y * src_h)
    pw = max(2, _even_down(round(w * src_w)))
    ph = max(2, _even_down(round(h * src_h)))
    # Keep inside the frame (frame dims may be odd -> use even-floored limits)
    max_w, max_h = _even_down(src_w), _even_down(src_h)
    pw = min(pw, max_w)
    ph = min(ph, max_h)
    px = min(px, max_w - pw)
    py = min(py, max_h - ph)
    return px, py, pw, ph


def normalize_layout(layout: dict | None) -> dict:
    """Fill defaults; returns {"preset", "regions": [...], "split_ratio"}."""
    if not isinstance(layout, dict):
        layout = DEFAULT_LAYOUT
    preset = layout.get("preset")
    if preset not in PRESETS:
        preset = "fill"
    regions = layout.get("regions")
    regions = [r for r in regions if isinstance(r, dict)] if isinstance(regions, list) else []
    if preset == "fill":
        regions = regions[:1] or list(DEFAULT_LAYOUT["regions"])
    elif preset == "split":
        regions = (regions + _DEFAULT_SPLIT_REGIONS[len(regions):])[:2]
    else:
        regions = []
    ratio = _num(layout, "split_ratio", 0.5)
    ratio = min(max(ratio, 0.2), 0.8)
    return {"preset": preset, "regions": regions, "split_ratio": ratio}


def split_heights(split_ratio: float) -> tuple[int, int]:
    top = _even_down(round(OUT_H * split_ratio))
    top = min(max(top, 2), OUT_H - 2)
    return top, OUT_H - top


def divider_y(layout: dict | None) -> int | None:
    """Y (output pixels) of the split divider line, or None if not a split layout."""
    n = normalize_layout(layout)
    return split_heights(n["split_ratio"])[0] if n["preset"] == "split" else None


def _cover_chain(box: tuple[int, int, int, int], w: int, h: int) -> str:
    x, y, cw, ch = box
    return (f"crop={cw}:{ch}:{x}:{y},"
            f"scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={w}:{h},setsar=1")


def build_filtergraph(layout: dict | None, src_w: int, src_h: int,
                      src_fps: float | None = None, ass_file: str | None = None) -> str:
    """Complete filter_complex: input [0:v], output [vout] (1080x1920 yuv420p)."""
    n = normalize_layout(layout)
    parts: list[str] = []
    inp = "[0:v]"
    if src_fps and src_fps > 30.5:
        parts.append("[0:v]fps=30[src]")
        inp = "[src]"

    if n["preset"] == "fill":
        box = region_to_pixels(n["regions"][0], src_w, src_h)
        parts.append(f"{inp}{_cover_chain(box, OUT_W, OUT_H)}[v0]")
    elif n["preset"] == "fit_blur":
        parts.append(f"{inp}split=2[bg][fg]")
        parts.append(
            f"[bg]scale={OUT_W}:{OUT_H}:force_original_aspect_ratio=increase,"
            f"crop={OUT_W}:{OUT_H},scale={OUT_W // 4}:{OUT_H // 4},gblur=sigma=8,"
            f"scale={OUT_W}:{OUT_H},eq=brightness=-0.12:saturation=0.9[bgb]")
        parts.append(f"[fg]scale={OUT_W}:-2:flags=lanczos,setsar=1[fgs]")
        parts.append("[bgb][fgs]overlay=(W-w)/2:(H-h)/2[v0]")
    else:  # split
        top_h, bot_h = split_heights(n["split_ratio"])
        top_box = region_to_pixels(n["regions"][0], src_w, src_h)
        bot_box = region_to_pixels(n["regions"][1], src_w, src_h)
        parts.append(f"{inp}split=2[a][b]")
        parts.append(f"[a]{_cover_chain(top_box, OUT_W, top_h)}[top]")
        parts.append(f"[b]{_cover_chain(bot_box, OUT_W, bot_h)}[bot]")
        parts.append("[top][bot]vstack=inputs=2[v0]")

    tail = f"ass={ass_file}," if ass_file else ""
    parts.append(f"[v0]{tail}format=yuv420p[vout]")
    return ";".join(parts)
