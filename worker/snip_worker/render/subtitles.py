"""Pure ASS subtitle generation (karaoke / simple)."""
from __future__ import annotations

from .layouts import OUT_H, OUT_W

FONT = "Arial Black"
KARAOKE_SIZE = 84
SIMPLE_SIZE = 64
MARGIN_V = 420
HIGHLIGHT = "&H0000F0FF&"  # BGR -> warm yellow
WHITE = "&H00FFFFFF&"

PAUSE_BREAK = 0.6
KARAOKE_MAX_WORDS = 3
KARAOKE_MAX_CHARS = 18
SIMPLE_MAX_WORDS = 6
SIMPLE_MAX_CHARS = 32
SIMPLE_PAUSE_BREAK = 0.8
_PUNCT = tuple(".,!?;:…")

_HEADER = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {OUT_W}
PlayResY: {OUT_H}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,{FONT},{KARAOKE_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,6,2,2,60,60,{MARGIN_V},1
Style: Simple,{FONT},{SIMPLE_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,5,2,2,70,70,{MARGIN_V},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def escape_ass(text: str) -> str:
    """Neutralize ASS special characters in a word."""
    text = text.replace("\r", " ").replace("\n", " ").replace("\\", "/")
    return text.replace("{", "\\{").replace("}", "\\}")


def fmt_time(t: float) -> str:
    cs = max(0, int(round(t * 100)))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, c = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def prepare_words(words: list[dict], clip_start: float, clip_end: float) -> list[dict]:
    """Shift absolute word times by -clip_start, clamp to the clip, drop empty/outside words."""
    dur = clip_end - clip_start
    out = []
    for w in sorted((w for w in words or []), key=lambda w: float(w.get("start", 0))):
        text = str(w.get("word", "")).strip()
        if not text:
            continue
        try:
            s = float(w["start"]) - clip_start
            e = float(w["end"]) - clip_start
        except (KeyError, TypeError, ValueError):
            continue
        if e <= 0 or s >= dur:
            continue
        s = max(0.0, s)
        e = min(dur, max(e, s + 0.05))
        out.append({"start": s, "end": e, "word": text})
    return out


def group_words(words: list[dict], max_words: int, max_chars: int, pause: float) -> list[list[dict]]:
    """Group shifted words; break on pauses, punctuation, or size limits."""
    groups: list[list[dict]] = []
    cur: list[dict] = []
    for w in words:
        if cur:
            chars = sum(len(x["word"]) for x in cur) + len(cur) + len(w["word"])
            if (len(cur) >= max_words or chars > max_chars
                    or w["start"] - cur[-1]["end"] > pause
                    or cur[-1]["word"].endswith(_PUNCT)):
                groups.append(cur)
                cur = []
        cur.append(w)
    if cur:
        groups.append(cur)
    return groups


def _dialogue(start: float, end: float, style: str, text: str) -> str:
    return f"Dialogue: 0,{fmt_time(start)},{fmt_time(end)},{style},,0,0,0,,{text}"


def _karaoke_events(words, pos_tag: str) -> list[str]:
    events = []
    for g in group_words(words, KARAOKE_MAX_WORDS, KARAOKE_MAX_CHARS, PAUSE_BREAK):
        texts = [escape_ass(w["word"]).upper() for w in g]
        for i, w in enumerate(g):
            s = w["start"]
            # Hold the slice until the next word starts (no flicker); last word ends at its end.
            e = g[i + 1]["start"] if i + 1 < len(g) else w["end"]
            e = max(e, s + 0.05)
            parts = []
            for j, t in enumerate(texts):
                if j == i:
                    parts.append(
                        f"{{\\1c{HIGHLIGHT}\\fscx88\\fscy88\\t(0,90,\\fscx108\\fscy108)}}{t}"
                        f"{{\\1c{WHITE}\\fscx100\\fscy100}}")
                else:
                    parts.append(t)
            events.append(_dialogue(s, e, "Karaoke", pos_tag + " ".join(parts)))
    return events


def _simple_events(words, pos_tag: str) -> list[str]:
    events = []
    groups = group_words(words, SIMPLE_MAX_WORDS, SIMPLE_MAX_CHARS, SIMPLE_PAUSE_BREAK)
    for g in groups:
        text = " ".join(escape_ass(w["word"]) for w in g)
        events.append(_dialogue(g[0]["start"], max(g[-1]["end"], g[0]["start"] + 0.1),
                                "Simple", pos_tag + text))
    return events


def generate_ass(words: list[dict], clip_start: float, clip_end: float, style: str,
                 divider_y: int | None = None) -> str | None:
    """Return ASS file content, or None when there is nothing to burn."""
    if style not in ("karaoke", "simple"):
        return None
    shifted = prepare_words(words, clip_start, clip_end)
    if not shifted:
        return None
    pos = f"{{\\an5\\pos({OUT_W // 2},{divider_y})}}" if divider_y is not None else ""
    events = (_karaoke_events if style == "karaoke" else _simple_events)(shifted, pos)
    return _HEADER + "\n".join(events) + "\n"
