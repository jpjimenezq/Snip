"""Genera los videos/imágenes de ejemplo del modo demo en web/public/demo/.

Usa el motor de render real del worker, así el clip final de la demo es exactamente
lo que produce Snip. Ejecutar desde la raíz del repo con el Python del worker:

    worker/.venv/Scripts/python web/scripts/make-demo-media.py
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "worker"))

from snip_worker.render import extract_frame, make_preview, render_clip  # noqa: E402

OUT = ROOT / "web" / "public" / "demo"
FONTS = Path("C:/Windows/Fonts")

# Video sintético 1920x1080 que imita un directo: juego de fondo + cámara arriba a la izquierda.
FILTER = (
    "[0:v]format=yuv420p,"
    # "juego": cuadrícula y un objeto que se mueve
    "drawgrid=w=160:h=160:t=2:c=white@0.06,"
    "drawbox=x='mod(t*260,1920)-120':y=620:w=240:h=140:c=0xf59e0b@0.9:t=fill,"
    "drawtext=fontfile=arialbd.ttf:text='PARTIDA EN CURSO':fontsize=64:fontcolor=white@0.85:"
    "x=(w-tw)/2+300:y=300,"
    "drawtext=fontfile=arial.ttf:text='KILLS 12   ·   RONDA 7':fontsize=40:fontcolor=white@0.6:"
    "x=(w-tw)/2+300:y=390,"
    # "cámara" del streamer
    "drawbox=x=40:y=40:w=560:h=420:c=0x0b0b10:t=fill,"
    "drawbox=x=40:y=40:w=560:h=420:c=0x8b5cf6:t=6,"
    "drawbox=x=250:y=120:w=140:h=170:c=0xd6a77a:t=fill,"
    "drawbox=x=200:y=300:w=240:h=160:c=0x3f3f46:t=fill,"
    "drawtext=fontfile=arialbd.ttf:text='CÁMARA':fontsize=34:fontcolor=white:x=64:y=64,"
    # etiqueta EN VIVO
    "drawbox=x=1700:y=40:w=180:h=60:c=0xdc2626:t=fill,"
    "drawtext=fontfile=arialbd.ttf:text='EN VIVO':fontsize=32:fontcolor=white:x=1722:y=54"
    "[v]"
)

WORDS_TEXT = (
    "no parce esto es una locura miren lo que acaba de pasar "
    "en el directo nadie se lo esperaba qué jugada tan brutal"
)


def make_source(path: Path, seconds: int = 20) -> None:
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", f"gradients=s=1920x1080:r=30:d={seconds}:c0=0x1e1b4b:c1=0x0f766e:speed=0.01",
        "-f", "lavfi", "-i", f"sine=frequency=180:sample_rate=48000:duration={seconds}",
        "-filter_complex", FILTER, "-map", "[v]", "-map", "1:a",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "96k",
        "-shortest", str(path),
    ]
    # cwd en la carpeta de fuentes para no escapar rutas de Windows dentro del filtro
    subprocess.run(cmd, check=True, cwd=FONTS, stdin=subprocess.DEVNULL)


def fake_words(start: float, end: float) -> list[dict]:
    words = WORDS_TEXT.split()
    step = (end - start) / len(words)
    return [
        {"start": start + i * step, "end": start + (i + 1) * step - 0.05, "word": w}
        for i, w in enumerate(words)
    ]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "source.mp4"
        make_source(src)
        extract_frame(str(src), 5.0, str(OUT / "frame.jpg"))
        extract_frame(str(src), 1.0, str(OUT / "thumb.jpg"))
        make_preview(str(src), 2.0, 14.0, str(OUT / "preview.mp4"))
        layout = {
            "preset": "split",
            "regions": [
                {"x": 0.0208, "y": 0.037, "w": 0.2917, "h": 0.3889},
                {"x": 0.30, "y": 0.0, "w": 0.6, "h": 1.0},
            ],
            "split_ratio": 0.4,
        }
        render_clip(str(src), 2.0, 14.0, layout, fake_words(2.2, 13.8), "karaoke",
                    str(OUT / "final.mp4"), encoder="libx264")
    for f in sorted(OUT.iterdir()):
        print(f"{f.name}: {f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
