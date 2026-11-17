"""Configuración del worker: carga worker/.env en un objeto tipado."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

WORKER_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    anthropic_api_key: str
    analysis_model: str
    copy_model: str
    whisper_model: str
    whisper_device: str
    whisper_compute_type: str
    whisper_language: str
    data_dir: Path
    video_encoder: str
    poll_seconds: float

    def require_supabase(self) -> None:
        if not self.supabase_url or not self.supabase_service_role_key:
            raise RuntimeError(
                "Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en worker/.env"
            )

    def require_anthropic(self) -> None:
        if not self.anthropic_api_key:
            raise RuntimeError("Falta ANTHROPIC_API_KEY en worker/.env")


def load_settings(env_file: Path | None = None) -> Settings:
    load_dotenv(env_file or WORKER_DIR / ".env", override=False)
    data_dir = Path(_env("SNIP_DATA_DIR", "./data")).expanduser()
    if not data_dir.is_absolute():
        data_dir = (WORKER_DIR / data_dir).resolve()
    try:
        poll = float(_env("SNIP_POLL_SECONDS", "3"))
    except ValueError:
        poll = 3.0
    return Settings(
        supabase_url=_env("SUPABASE_URL"),
        supabase_service_role_key=_env("SUPABASE_SERVICE_ROLE_KEY"),
        anthropic_api_key=_env("ANTHROPIC_API_KEY"),
        analysis_model=_env("SNIP_ANALYSIS_MODEL", "claude-sonnet-5-5"),
        copy_model=_env("SNIP_COPY_MODEL", "claude-haiku-5-5"),
        whisper_model=_env("WHISPER_MODEL", "large-v3-turbo"),
        whisper_device=_env("WHISPER_DEVICE", "cuda"),
        whisper_compute_type=_env("WHISPER_COMPUTE_TYPE", "int8_float16"),
        whisper_language=_env("WHISPER_LANGUAGE", "es"),
        data_dir=data_dir,
        video_encoder=_env("SNIP_VIDEO_ENCODER", "h264_nvenc"),
        poll_seconds=max(0.5, poll),
    )


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = load_settings()
    return _settings
