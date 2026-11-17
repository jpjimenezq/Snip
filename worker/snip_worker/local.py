"""Modo local: corre el pipeline real SIN Supabase.

    python -m snip_worker.local <url-o-archivo> [opciones]

Todo queda en SNIP_DATA_DIR/local/<slug>/ (video, transcripción, clips 9:16,
resultado.json e index.html para revisar los resultados)."""
from __future__ import annotations

import argparse
import dataclasses
import hashlib
import html
import json
import logging
import re
import sys
import time
from pathlib import Path

from . import config
from .logsetup import setup_logging
from .transcript_utils import fmt_ts, text_in_range, words_in_range

log = logging.getLogger("snip.local")

LAYOUTS = ("fill", "fit_blur", "split")
SUBS = ("karaoke", "simple", "none")
# split por defecto: dos personas lado a lado (izquierda arriba, derecha abajo)
SPLIT_REGIONS = [{"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0}, {"x": 0.5, "y": 0.0, "w": 0.5, "h": 1.0}]


# ------------------------------------------------------------------ utilidades puras
def parse_time(value: str | float | int | None) -> float | None:
    """'90', '1:30' o '1:02:03' -> segundos."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    parts = str(value).strip().split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        raise ValueError(f"Tiempo inválido: {value!r} (usa segundos, mm:ss o hh:mm:ss)") from None
    if len(nums) > 3:
        raise ValueError(f"Tiempo inválido: {value!r}")
    total = 0.0
    for n in nums:
        total = total * 60 + n
    return total


def parse_regions(text: str | None) -> list[dict] | None:
    """'x,y,w,h;x,y,w,h' (valores 0..1) -> lista de regiones."""
    if not text:
        return None
    regions = []
    for chunk in text.split(";"):
        try:
            x, y, w, h = (float(v) for v in chunk.split(","))
        except ValueError:
            raise ValueError(f"Región inválida: {chunk!r} (formato x,y,w,h con valores 0..1)") from None
        regions.append({"x": x, "y": y, "w": w, "h": h})
    return regions


def make_slug(source: str) -> str:
    """Nombre de carpeta estable: id de YouTube si se reconoce, si no el nombre del archivo/URL."""
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/)([A-Za-z0-9_-]{11})", source)
    if m:
        return "yt-" + m.group(1)
    p = Path(source)
    base = p.stem if p.suffix and not source.startswith(("http://", "https://")) else source
    base = re.sub(r"[^A-Za-z0-9_-]+", "-", base).strip("-")[:40] or "video"
    if source.startswith(("http://", "https://")):
        base += "-" + hashlib.sha1(source.encode()).hexdigest()[:6]
    return base


def build_layout(layout: str, track_face: bool, auto_zoom: bool, regions: list[dict] | None) -> dict:
    """Layout en el contrato de clips.layout (ver docs/ARCHITECTURE.md)."""
    out: dict = {"preset": layout}
    if layout == "fill":
        out["regions"] = (regions or [])[:1] or [{"x": 0.342, "y": 0, "w": 0.316, "h": 1}]
    elif layout == "split":
        out["regions"] = (regions or []) + SPLIT_REGIONS[len(regions or []):]
        out["regions"] = out["regions"][:2]
    if track_face:
        out["track_face"] = True
    if auto_zoom:
        out["auto_zoom"] = True
    return out


def offset_segments(segments: list[dict], offset: float) -> list[dict]:
    """Desplaza los tiempos de una transcripción hecha sobre un trozo del video."""
    if not offset:
        return segments
    out = []
    for s in segments:
        out.append({**s, "start": round(s["start"] + offset, 3), "end": round(s["end"] + offset, 3),
                    "words": [{**w, "start": round(w["start"] + offset, 3), "end": round(w["end"] + offset, 3)}
                              for w in s.get("words") or []]})
    return out


def clamp_moments(moments: list[dict], start: float, end: float, min_s: float = 3.0) -> list[dict]:
    out = []
    for m in moments:
        a, b = max(start, m["start_s"]), min(end, m["end_s"])
        if b - a >= min_s:
            out.append({**m, "start_s": round(a, 3), "end_s": round(b, 3)})
    return out


# ------------------------------------------------------------------ pasos del pipeline
def _apply_overrides(args) -> config.Settings:
    s = config.get_settings()
    changes = {}
    for attr, val in (("whisper_model", args.whisper_model), ("whisper_device", args.device),
                      ("whisper_compute_type", args.compute_type), ("whisper_language", args.language)):
        if val:
            changes[attr] = val
    if changes:
        s = dataclasses.replace(s, **changes)
        config._settings = s
    return s


def prepare_source(source: str, work: Path) -> tuple[Path, dict, float]:
    """Devuelve (ruta del video, metadatos, segundos que tardó la descarga)."""
    from . import ingest, render

    p = Path(source).expanduser()
    if p.exists():
        log.info("Usando el archivo local: %s", p)
        info = render.probe(str(p))
        return p, {"title": p.stem, "channel": None, "duration": info["duration"]}, 0.0
    if not source.startswith(("http://", "https://")):
        raise SystemExit(f"No existe el archivo y tampoco parece una URL: {source}")
    t0 = time.monotonic()
    log.info("Descargando %s ...", source)
    last = [0.0]

    def prog(v: float) -> None:
        if v - last[0] >= 0.1:
            last[0] = v
            log.info("  descarga %.0f %%", v * 100)

    video, meta = ingest.download(source, work, prog)
    return video, meta, time.monotonic() - t0


def get_transcript(video: Path, work: Path, start: float, end: float | None, force: bool
                   ) -> tuple[list[dict], dict]:
    """Transcribe el rango (con caché en transcript.json). Devuelve (segments, stats)."""
    from . import ingest, transcribe

    s = config.get_settings()
    cache = work / "transcript.json"
    key = {"start": start, "end": end, "model": s.whisper_model, "language": s.whisper_language}
    if cache.exists() and not force:
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("key") == key:
            log.info("Se reutiliza la transcripción guardada (%s)", cache)
            return data["segments"], data["stats"]
    audio = work / ("audio.wav" if (start == 0 and end is None) else f"audio_{int(start)}_{int(end or 0)}.wav")
    if not audio.exists():
        log.info("Extrayendo audio...")
        seek = ["-ss", f"{start:.3f}"] if start else []
        length = ["-t", f"{end - start:.3f}"] if end is not None else []
        ingest._run_ffmpeg([*seek, "-i", str(video), *length, "-vn", "-ac", "1", "-ar", "16000",
                            "-c:a", "pcm_s16le", str(audio)])
    audio_s = max(0.0, (audio.stat().st_size - 44) / 32000.0)  # wav mono 16 kHz s16
    log.info("Transcribiendo %.0f s de audio con Whisper (%s, %s, %s)...", audio_s, s.whisper_model,
             s.whisper_device, s.whisper_compute_type)
    last = [0.0]

    def prog(v: float) -> None:
        if v - last[0] >= 0.1:
            last[0] = v
            log.info("  transcripción %.0f %%", v * 100)

    t0 = time.monotonic()
    segments, language = transcribe.transcribe(str(audio), prog)
    took = time.monotonic() - t0
    segments = offset_segments(segments, start)
    stats = {"audio_s": round(audio_s, 1), "transcripcion_s": round(took, 1),
             "velocidad_x_tiempo_real": round(audio_s / took, 2) if took > 0 else None,
             "idioma": language, "modelo": s.whisper_model, "dispositivo": s.whisper_device,
             "compute_type": s.whisper_compute_type, "palabras": sum(len(x.get("words") or []) for x in segments)}
    cache.write_text(json.dumps({"key": key, "stats": stats, "segments": segments}, ensure_ascii=False),
                     encoding="utf-8")
    return segments, stats


def pick_moments(video: Path, segments: list[dict], start: float, end: float, max_clips: int,
                 clip_s: float, use_ai: bool) -> tuple[list[dict], str]:
    """Devuelve (momentos, modo) con modo 'claude' o 'sin IA'."""
    from . import analyze, heuristic

    s = config.get_settings()
    if use_ai and s.anthropic_api_key:
        try:
            log.info("Buscando momentos con Claude (%s)...", s.analysis_model)
            moments = analyze.find_moments(segments, end)
            moments = clamp_moments(moments, start, end)
            moments.sort(key=lambda m: -m["score"])
            return sorted(moments[:max_clips], key=lambda m: m["start_s"]), "claude"
        except Exception as exc:  # noqa: BLE001
            log.warning("Falló el análisis con Claude (%s: %s); se usa el selector sin IA.",
                        type(exc).__name__, exc)
    elif use_ai:
        log.info("No hay ANTHROPIC_API_KEY: se usa el selector heurístico SIN IA (volumen + densidad de habla).")
    log.info("Calculando picos de volumen...")
    db = heuristic.loudness_curve(str(video), start, end)
    raw = heuristic.pick_moments(segments, db, start, end, max_clips, clip_s)
    snapped = analyze.snap_moments(raw, segments, end)
    for m, r in zip(snapped, raw):  # snap_moments no conserva textos si cambian; los reponemos
        m["reason"] = m["reason"] or r["reason"]
    return clamp_moments(snapped, start, end)[:max_clips], "sin IA"


def render_one(video: Path, moment: dict, segments: list[dict], layout: dict, subs: str,
               out: Path, encoder: str) -> dict:
    from . import render

    words = words_in_range(segments, moment["start_s"], moment["end_s"])
    t0 = time.monotonic()
    used = render.render_with_fallback(str(video), moment["start_s"], moment["end_s"], layout, words,
                                       subs, str(out), encoder)
    took = time.monotonic() - t0
    poster = out.with_suffix(".jpg")
    try:
        render.extract_frame(str(out), min(1.0, max(0.0, moment["end_s"] - moment["start_s"] - 0.5)), str(poster))
    except Exception as exc:  # noqa: BLE001
        log.warning("No se pudo sacar el póster de %s: %s", out.name, exc)
    return {"render_s": round(took, 1), "encoder": used, "palabras": len(words)}


# ------------------------------------------------------------------ salida
def write_gallery(work: Path, result: dict) -> Path:
    e = html.escape
    cards = []
    for c in result["clips"]:
        lay = c["layout_opts"]
        cards.append(f"""<article>
<video controls preload="metadata" poster="{e(c['poster'])}" src="{e(c['archivo'])}"></video>
<div class="meta"><h2>{e(c['titulo'])}</h2>
<p><b>{e(fmt_ts(c['inicio_s']))}</b> a <b>{e(fmt_ts(c['fin_s']))}</b> ({c['fin_s'] - c['inicio_s']:.0f} s) &middot; puntaje {c['score']}</p>
<p>Layout: <b>{e(lay['layout'])}</b> &middot; subtítulos: <b>{e(lay['subs'])}</b>{' &middot; seguimiento de cara' if lay['track_face'] else ''}{' &middot; zoom automático' if lay['auto_zoom'] else ''}</p>
<p class="dim">{e(c['razon'])}</p>
<p class="dim">Render: {c['render_s']} s ({e(c['encoder'])})</p>
<details><summary>Texto</summary><p>{e(c['texto'])}</p></details></div></article>""")
    page = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snip local: {e(result['fuente']['titulo'] or result['slug'])}</title>
<style>body{{font:15px system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:24px}}
h1{{font-size:20px}}.grid{{display:flex;flex-wrap:wrap;gap:20px}}article{{width:300px;background:#1b1b1b;border-radius:10px;overflow:hidden}}
video{{width:100%;aspect-ratio:9/16;background:#000;display:block}}.meta{{padding:12px}}h2{{font-size:15px;margin:0 0 6px}}
p{{margin:4px 0}}.dim{{color:#9a9a9a;font-size:13px}}.tag{{background:#7a4b00;padding:2px 8px;border-radius:6px}}
details{{margin-top:6px;font-size:13px}}</style></head><body>
<h1>{e(result['fuente']['titulo'] or result['slug'])}</h1>
<p class="dim">Selección de momentos: <span class="tag">{e(result['analisis'])}</span> &middot; rango {e(fmt_ts(result['rango']['inicio_s']))} - {e(fmt_ts(result['rango']['fin_s']))}</p>
<div class="grid">{''.join(cards)}</div></body></html>"""
    path = work / "index.html"
    path.write_text(page, encoding="utf-8")
    return path


def run(args) -> int:
    settings = _apply_overrides(args)
    start = parse_time(args.start) or 0.0
    end_arg = parse_time(args.end)
    slug = args.slug or make_slug(args.source)
    work = settings.data_dir / "local" / slug
    clips_dir = work / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    log.info("Carpeta de trabajo: %s", work)

    from . import render

    video, meta, download_s = prepare_source(args.source, work)
    total = render.probe(str(video))["duration"]
    end = min(end_arg, total) if end_arg else total
    if start >= end:
        raise SystemExit(f"Rango inválido: inicio {start} >= fin {end} (el video dura {total:.0f} s)")
    ranged = start > 0 or end < total - 0.5
    segments, tstats = get_transcript(video, work, start, end if ranged else None, args.force_transcribe)
    if not segments:
        raise SystemExit("La transcripción quedó vacía (¿sin voz en el rango?).")

    moments, mode = pick_moments(video, segments, start, end, args.max_clips, args.clip_seconds, not args.no_ai)
    if args.only:
        moments = moments[args.only - 1:args.only]
    if not moments:
        raise SystemExit("No se encontraron momentos para clips en el rango.")
    log.info("Modo de análisis: %s -> %d momento(s)", mode, len(moments))

    layout = build_layout(args.layout, args.track_face, args.auto_zoom, parse_regions(args.regions))
    result_path = work / "resultado.json"
    prev = {}
    if result_path.exists():
        try:
            prev = json.loads(result_path.read_text(encoding="utf-8"))
        except ValueError:
            prev = {}
    clips = {c["archivo"]: c for c in prev.get("clips", [])}
    base_idx = args.only or 1
    for i, m in enumerate(moments):
        idx = base_idx + i
        name = f"clip{idx:02d}_{args.layout}.mp4"
        out = clips_dir / name
        log.info("Renderizando clip %d/%d (%s - %s, layout %s, subs %s)...", i + 1, len(moments),
                 fmt_ts(m["start_s"]), fmt_ts(m["end_s"]), args.layout, args.subs)
        r = render_one(video, m, segments, layout, args.subs, out, args.encoder)
        log.info("  listo en %.1f s -> %s", r["render_s"], out)
        rel = f"clips/{name}"
        clips[rel] = {
            "archivo": rel, "poster": f"clips/{out.with_suffix('.jpg').name}",
            "titulo": m["title"], "hook": m["hook"], "razon": m["reason"], "score": m["score"],
            "inicio_s": m["start_s"], "fin_s": m["end_s"], "layout": layout,
            "layout_opts": {"layout": args.layout, "subs": args.subs, "track_face": args.track_face,
                            "auto_zoom": args.auto_zoom},
            "texto": text_in_range(segments, m["start_s"], m["end_s"]),
            "render_s": r["render_s"], "encoder": r["encoder"],
        }
    result = {
        "slug": slug, "carpeta": str(work),
        "fuente": {"origen": args.source, "video": str(video), "titulo": meta.get("title"),
                   "canal": meta.get("channel"), "duracion_s": round(total, 1)},
        "rango": {"inicio_s": start, "fin_s": end},
        "analisis": mode,
        "tiempos": {"descarga_s": round(download_s, 1), **tstats},
        "clips": sorted(clips.values(), key=lambda c: c["archivo"]),
    }
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    index = write_gallery(work, result)
    log.info("Listo. Resultados: %s", result_path)
    log.info("Galería para revisar: %s", index)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m snip_worker.local",
        description="Corre el pipeline de Snip (descarga, transcripción, momentos, render 9:16) "
                    "sin Supabase. Los resultados quedan en SNIP_DATA_DIR/local/<slug>/.")
    p.add_argument("source", help="URL (YouTube, Kick, Twitch...) o ruta a un archivo de video")
    p.add_argument("--start", help="inicio del rango a procesar (segundos, mm:ss o hh:mm:ss)")
    p.add_argument("--end", help="fin del rango a procesar")
    p.add_argument("--max-clips", type=int, default=3, help="cantidad de clips (por defecto 3)")
    p.add_argument("--clip-seconds", type=float, default=30.0, help="duración objetivo del selector sin IA (30 s)")
    p.add_argument("--only", type=int, metavar="N",
                   help="renderiza solo el momento N (1..max-clips); sirve para probar otro layout sin repetir todo")
    p.add_argument("--layout", choices=LAYOUTS, default="fill")
    p.add_argument("--subs", choices=SUBS, default="karaoke", help="estilo de subtítulos")
    p.add_argument("--regions", help="regiones x,y,w,h (0..1) separadas por ';' (fill: 1, split: arriba;abajo)")
    p.add_argument("--track-face", action="store_true", help="seguir la cara con el recorte")
    p.add_argument("--auto-zoom", action="store_true", help="zoom automático en picos de volumen")
    p.add_argument("--no-ai", action="store_true", help="no usar Claude aunque haya ANTHROPIC_API_KEY")
    p.add_argument("--encoder", default="libx264", choices=("libx264", "h264_nvenc"),
                   help="codificador de video (libx264 por defecto; NVENC cae a libx264 si falla)")
    p.add_argument("--whisper-model", help="sobrescribe WHISPER_MODEL (ej. small)")
    p.add_argument("--device", help="sobrescribe WHISPER_DEVICE (cuda o cpu)")
    p.add_argument("--compute-type", help="sobrescribe WHISPER_COMPUTE_TYPE")
    p.add_argument("--language", help="sobrescribe WHISPER_LANGUAGE (es, en, auto)")
    p.add_argument("--force-transcribe", action="store_true", help="ignora la transcripción guardada")
    p.add_argument("--slug", help="nombre de la carpeta de salida")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    setup_logging(None)
    try:
        return run(args)
    except KeyboardInterrupt:
        log.info("Cancelado.")
        return 130
    except ValueError as exc:
        log.error("%s", exc)
        return 2


if __name__ == "__main__":
    sys.exit(main())
