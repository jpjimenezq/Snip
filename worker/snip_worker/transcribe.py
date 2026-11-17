"""Transcripción local con faster-whisper (palabra por palabra)."""
from __future__ import annotations

import gc
import logging
import os
import sys
from pathlib import Path
from typing import Callable

from .config import get_settings

log = logging.getLogger("snip.transcribe")

_dll_dirs_done = False


def _register_cuda_dlls() -> None:
    """En Windows, faster-whisper necesita cuBLAS y cuDNN 9 (CUDA 12). Si se instalaron
    con pip (nvidia-cublas-cu12 / nvidia-cudnn-cu12) las DLL quedan dentro de
    site-packages/nvidia/*/bin; las agregamos al PATH / DLL search path."""
    global _dll_dirs_done
    if _dll_dirs_done or sys.platform != "win32":
        _dll_dirs_done = True
        return
    _dll_dirs_done = True
    for base in sys.path:
        nv = Path(base) / "nvidia"
        if not nv.is_dir():
            continue
        for sub in nv.iterdir():
            bin_dir = sub / "bin"
            if bin_dir.is_dir():
                try:
                    os.add_dll_directory(str(bin_dir))
                except (OSError, AttributeError):
                    pass
                os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")


def cuda_libs_available() -> bool:
    """En Windows comprueba que cuBLAS y cuDNN se puedan cargar; sin ellas CTranslate2
    puede quedarse colgado en lugar de lanzar un error."""
    if sys.platform != "win32":
        return True
    import ctypes

    for dll in ("cublas64_12.dll", "cudnn64_9.dll"):
        try:
            ctypes.WinDLL(dll)
        except OSError:
            log.warning("No se encontró %s", dll)
            return False
    return True


def _clean_segment(seg) -> dict:
    words = []
    for w in seg.words or []:
        token = (w.word or "").strip()
        if not token:
            continue
        words.append({"start": round(float(w.start), 3), "end": round(float(w.end), 3), "word": token})
    return {
        "start": round(float(seg.start), 3),
        "end": round(float(seg.end), 3),
        "text": (seg.text or "").strip(),
        "words": words,
    }


def _run(audio_path: str, model_name: str, device: str, compute_type: str, language: str | None,
         on_progress: Callable[[float], None] | None) -> tuple[list[dict], str | None]:
    from faster_whisper import WhisperModel  # carga perezosa

    log.info("Cargando modelo Whisper '%s' (%s, %s)...", model_name, device, compute_type)
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    try:
        segments_iter, info = model.transcribe(
            audio_path,
            language=language or None,
            word_timestamps=True,
            vad_filter=True,
            beam_size=5,
        )
        duration = float(info.duration or 0) or None
        out: list[dict] = []
        for seg in segments_iter:
            out.append(_clean_segment(seg))
            if on_progress and duration:
                on_progress(min(1.0, float(seg.end) / duration))
        if on_progress:
            on_progress(1.0)
        return out, getattr(info, "language", language)
    finally:
        del model
        gc.collect()


def transcribe(audio_path: str, on_progress: Callable[[float], None] | None = None) -> tuple[list[dict], str | None]:
    """Devuelve (segments, language) con el contrato de transcripts.segments."""
    s = get_settings()
    _register_cuda_dlls()
    language = s.whisper_language if s.whisper_language and s.whisper_language != "auto" else None
    if s.whisper_device != "cpu" and not cuda_libs_available():
        log.warning(
            "Faltan las bibliotecas CUDA (cuBLAS/cuDNN 9 para CUDA 12): Whisper usará CPU con int8 "
            "(más lento). Instala `nvidia-cublas-cu12` y `nvidia-cudnn-cu12` en el venv; "
            "ver worker/README.md > CUDA en Windows."
        )
        return _run(audio_path, s.whisper_model, "cpu", "int8", language, on_progress)
    try:
        return _run(audio_path, s.whisper_model, s.whisper_device, s.whisper_compute_type, language, on_progress)
    except Exception as exc:
        if s.whisper_device == "cpu":
            raise
        log.warning(
            "Whisper falló en %s (%s: %s). Posible falta de cuDNN/cuBLAS o poca VRAM. "
            "Reintentando en CPU con int8 (más lento). Ver worker/README.md > CUDA en Windows.",
            s.whisper_device, type(exc).__name__, exc,
        )
        _free_gpu()
        return _run(audio_path, s.whisper_model, "cpu", "int8", language, on_progress)


def _free_gpu() -> None:
    gc.collect()
    try:
        import torch  # type: ignore

        torch.cuda.empty_cache()
    except Exception:
        pass
