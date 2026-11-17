# Snip worker

Worker en Python que corre en tu PC. Hace polling de la tabla `jobs` en Supabase y ejecuta:

| job | qué hace |
|-----|----------|
| `process_source` | descarga (yt-dlp) → transcribe (faster-whisper) → detecta momentos (Claude) → crea clips `suggested` con frame + preview → encola `generate_copy` |
| `manual_clip` | crea un clip que termina en `at_s` y empieza `duration_s` antes (si el video no está procesado, corre primero `process_source`) |
| `render_clip` | render final 1080x1920 con subtítulos, sube `clips/{id}/final.mp4` |
| `generate_copy` | genera los copies para YouTube / TikTok / Instagram / Facebook |

Procesa **un job a la vez** (la GPU es chica). Los videos fuente se quedan en `SNIP_DATA_DIR`; a Supabase Storage solo se suben miniaturas, frames, previews y clips finales.

## Requisitos

- Windows 11, Python 3.12, `ffmpeg` y `ffprobe` en el PATH (`ffmpeg -version`).
- GPU NVIDIA con driver reciente (para Whisper en CUDA y para NVENC).
- Proyecto de Supabase con `supabase/migrations/0001_init.sql` ya ejecutada.

## Instalación

```powershell
cd worker
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # y llena los valores
```

### `.env`

- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`: Supabase > Project Settings > API (la **service role**, nunca la publiques).
- `ANTHROPIC_API_KEY`: la creas en <https://console.anthropic.com> > API Keys. **Solo vive en este archivo** (`worker/.env`), nunca en `web/`.
- `SNIP_ANALYSIS_MODEL` (por defecto `claude-sonnet-5-5`) y `SNIP_COPY_MODEL` (por defecto `claude-haiku-5-5`).
- `WHISPER_MODEL=large-v3-turbo`, `WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=int8_float16`, `WHISPER_LANGUAGE=es`. Con 4 GB de VRAM `large-v3-turbo` en `int8_float16` cabe; si te quedas sin memoria usa `medium` o `small`.
- `SNIP_DATA_DIR=./data` (relativo a `worker/`; también puede ser una ruta absoluta en otro disco).
- `SNIP_VIDEO_ENCODER=h264_nvenc` (o `libx264` para CPU). Si NVENC falla, el worker reintenta solo con `libx264`.

### CUDA en Windows (faster-whisper)

> `nvidia-cudnn-cu12` pesa ~700 MB y `nvidia-cublas-cu12` ~550 MB; la primera instalación puede tardar según tu conexión.

faster-whisper (CTranslate2) en GPU necesita **cuBLAS y cuDNN 9 para CUDA 12**. No hace falta instalar el CUDA Toolkit completo: `requirements.txt` incluye `nvidia-cublas-cu12` y `nvidia-cudnn-cu12` (wheels de pip) y el worker registra automáticamente sus DLL (`.venv\Lib\site-packages\nvidia\*\bin`) antes de cargar el modelo.

Alternativas si eso no te funciona (según el README de faster-whisper): descargar las DLL de cuBLAS/cuDNN de <https://github.com/Purfview/whisper-standalone-win/releases/tag/libs> y ponerlas en una carpeta del `PATH`, o instalar el CUDA Toolkit 12 + cuDNN 9 oficiales.

Si CUDA falla de todos modos, el worker lo avisa en la consola y **reintenta en CPU con int8** (mucho más lento, pero termina).

## Ejecutar

```powershell
.\run.ps1
# o, con el venv activado:
python -m snip_worker
```

Ctrl+C cierra el worker de forma ordenada; el job en curso vuelve a la cola (`pending`).

## Pruebas

```powershell
pytest
```

No necesitan red, Supabase, GPU ni API key.

## Solución de problemas

- **`Could not load library cudnn_...dll` / `cublas64_12.dll not found`**: reinstala `pip install -r requirements.txt` dentro del venv. Mientras tanto Whisper seguirá en CPU.
- **`CUDA out of memory`**: cierra otras apps con GPU o baja a `WHISPER_MODEL=medium` / `small`.
- **Kick / Twitch no descarga**: actualiza yt-dlp (`pip install -U yt-dlp`); esos sitios cambian seguido. Los VODs privados o solo para suscriptores no se pueden bajar.
- **YouTube pide iniciar sesión / "confirm you're not a bot"**: actualiza yt-dlp (`pip install -U yt-dlp`). El soporte de cookies del navegador todavía no está implementado en el worker.
- **`Falta ANTHROPIC_API_KEY`**: pon la clave en `worker/.env`. Los jobs de análisis y copies fallarán hasta que la pongas (el job queda en `error` con el mensaje).
- **Un job quedó en `error`**: el mensaje está en `jobs.error` y en `sources.error` / `clips.error`. Para reintentar, crea otro job desde la web.
- **Claude rechazó la solicitud (`refusal`)**: se registra el motivo; para el análisis ya se activa el fallback del servidor (`fallbacks: "default"`). Haiku no tiene fallback.
- **NVENC no disponible**: pon `SNIP_VIDEO_ENCODER=libx264`.
