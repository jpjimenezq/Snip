# Snip — Arquitectura y contratos

Plataforma personal (un solo usuario) para generar clips verticales para redes sociales
a partir de directos (Kick/Twitch), VODs y videos de YouTube, con transcripción local
(Whisper), detección de momentos con IA (Claude), edición sencilla y, más adelante,
publicación en redes.

## Piezas

```
┌──────────────────────┐        ┌───────────────────────────┐
│  web/  (Next.js)     │        │  Supabase (capa gratis)   │
│  Desplegado en Vercel│◄──────►│  - Postgres (tablas abajo)│
│  Panel PC + celular  │        │  - Auth (1 usuario)       │
│  PWA (share target)  │        │  - Storage bucket "clips" │
└──────────────────────┘        └─────────────▲─────────────┘
                                              │ service role key
                                ┌─────────────┴─────────────┐
                                │  worker/ (Python, tu PC)  │
                                │  RTX 3050 Laptop 4 GB     │
                                │  yt-dlp · faster-whisper  │
                                │  Claude API · FFmpeg      │
                                └───────────────────────────┘
```

- **web/** nunca procesa video. Solo lee/escribe filas y crea `jobs`.
- **worker/** corre en el PC del usuario. Hace polling de `jobs`, procesa y sube a Storage
  solo archivos pequeños (clips finales, previews, frames). Los videos fuente se quedan en
  disco local (`SNIP_DATA_DIR`).
- La clave de Anthropic vive **solo** en `worker/.env`.

## Fases

1. **(esta)** Enlace (YouTube / VOD de Kick o Twitch) → descarga → transcripción → momentos
   sugeridos por IA → editor de layout → render 9:16 con subtítulos → descarga + copies por red.
   También clip manual (timestamp + duración 5/10/15/30/45/60/personalizado).
2. Más plantillas de edición (zoom, seguimiento de cara).
3. Extensión de Chrome con atajo `Alt+Shift+S` + grabación en vivo con búfer.
4. Publicación en TikTok / Instagram / Facebook / YouTube.

## Flujo de estados

```
source:  queued → downloading → transcribing → analyzing → ready
                                                        ↘ error
clip:    suggested → queued_render → rendering → rendered
                                              ↘ error
```

Jobs (`jobs.type`):

| type             | payload                         | lo crea                    | hace                                                        |
|------------------|---------------------------------|----------------------------|-------------------------------------------------------------|
| `process_source` | `{source_id}`                   | web al pegar un enlace     | descarga, transcribe, analiza, crea clips `suggested` con preview y frame |
| `render_clip`    | `{clip_id}`                     | web al darle "Renderizar"  | render final 1080x1920, sube a Storage, `rendered`          |
| `generate_copy`  | `{clip_id}`                     | web ("Generar copies") y el worker tras `process_source` | llena `clips.copies` |
| `manual_clip`    | `{source_id, at_s, duration_s}` | web (clip manual)          | crea un clip `origin='manual'` que termina en `at_s` y empieza `duration_s` antes (con preview+frame) |

El worker reclama jobs con la función SQL `claim_job(p_worker_id text)` (usa
`FOR UPDATE SKIP LOCKED`) y los cierra con `UPDATE jobs SET status='done'|'error'`.

## Base de datos

Ver `supabase/migrations/0001_init.sql` (fuente de verdad).

## Contrato `clips.layout` (jsonb)

Coordenadas **normalizadas 0..1** sobre el frame horizontal de la fuente.

```jsonc
{
  "preset": "fill",           // "fill" | "fit_blur" | "split"
  // fill:     un recorte vertical (9:16) que llena la pantalla
  // fit_blur: video completo centrado, fondo con el mismo video desenfocado
  // split:    dos recortes apilados (arriba / abajo)
  "regions": [
    { "x": 0.35, "y": 0.0, "w": 0.316, "h": 1.0 }   // fill: 1 región; split: [arriba, abajo]
  ],
  "split_ratio": 0.5          // solo split: fracción de altura para la región de arriba
}
```

Valor por defecto si `layout` es null: `{"preset":"fill","regions":[{"x":0.342,"y":0,"w":0.316,"h":1}]}`
(recorte centrado; 0.316 ≈ (9/16)/(16/9) para fuente 16:9).

El render escala cada región para cubrir su zona de salida (crop centrado si la proporción
no coincide exactamente).

## Contrato `clips.subtitle_style` (text)

`"karaoke"` (palabra resaltada, 2-4 palabras por línea, MAYÚSCULAS, borde negro grueso) |
`"simple"` (frases cortas, blanco con borde) | `"none"`.
Posición: tercio inferior en `fill`/`fit_blur`; en `split`, sobre la línea divisoria.

## Contrato `clips.copies` (jsonb)

```json
{
  "youtube":   { "title": "...", "description": "...", "tags": ["..."] },
  "tiktok":    { "caption": "...", "hashtags": ["#..."] },
  "instagram": { "caption": "...", "hashtags": ["#..."] },
  "facebook":  { "caption": "..." }
}
```

## Contrato `transcripts.segments` (jsonb)

Tiempos en segundos absolutos de la fuente.

```json
[
  { "start": 12.3, "end": 15.9, "text": "hola parce qué más",
    "words": [ { "start": 12.3, "end": 12.6, "word": "hola" } ] }
]
```

## Storage

Bucket privado `clips`. Rutas (keys):

- `sources/{source_id}/thumb.jpg`
- `clips/{clip_id}/frame.jpg` — frame en el inicio del clip (para el editor de layout)
- `clips/{clip_id}/preview.mp4` — horizontal, 480p, bajo bitrate (para previsualizar)
- `clips/{clip_id}/final.mp4` — 1080x1920 H.264 + AAC

La web usa URLs firmadas (`createSignedUrl`).

## Variables de entorno

`worker/.env` (ver `worker/.env.example`) y `web/.env.local` (ver `web/.env.example`).
