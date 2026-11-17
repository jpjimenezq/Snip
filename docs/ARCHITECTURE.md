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

---

# Fases 2–4 (contratos)

Esquema nuevo en `supabase/migrations/0002_live_publish.sql` (fuente de verdad).

## Fase 2 — Edición: campos extra en `clips.layout`

Todos opcionales; si faltan, se comporta como la fase 1.

```jsonc
{
  "preset": "fill",
  "regions": [ ... ],
  "split_ratio": 0.5,
  "track_face": true,        // fill y split: cada región sigue la cara más grande dentro de ella
                             // (la región dibujada es la posición inicial / respaldo)
  "zooms": [                 // punch-in zooms; segundos RELATIVOS al inicio del clip
    { "start": 3.2, "end": 5.0, "scale": 1.3 }
  ],
  "auto_zoom": false         // el worker agrega zooms en picos de audio / palabras enfáticas
}
```

## Fase 3 — En vivo y atajo de teclado

- `live_watches`: canales que el worker graba continuamente en un búfer circular en disco
  (`SNIP_LIVE_BUFFER_MIN`, por defecto 15 min) con `streamlink` + segmentos de ffmpeg.
  El worker actualiza `status`, `buffer_s` y `last_seen_at` (heartbeat ~10 s).
- Job `live_clip` payload:
  `{ "url": "https://kick.com/canal", "duration_s": 30, "requested_at": "<ISO UTC>" }`
  El worker toma del búfer el tramo `[requested_at - SNIP_LIVE_DELAY_S - duration_s, requested_at - SNIP_LIVE_DELAY_S]`,
  crea un `source` nuevo (status `ready`, título "En vivo · canal · hh:mm") con ese tramo como video,
  lo transcribe, crea un `clip` `origin='hotkey'` que cubre todo el tramo (frame + preview) y encola `generate_copy`.
  Si el canal no se estaba grabando: crea el `live_watch` (enabled) y falla el job con un mensaje claro.
- **Extensión de Chrome** (`extension/`, Manifest V3): atajo `Alt+Shift+S`.
  - Se autentica con Supabase (correo + contraseña, URL y anon key en sus opciones) y escribe con RLS.
  - En la pestaña actual muestra un panel flotante con duraciones 5/10/15/30/45/60/personalizado
    (teclas 1–6, Enter = 30 s, Esc cancela).
  - Canal en vivo (Kick/Twitch/YouTube live) → job `live_clip`.
  - VOD / video de YouTube → busca o crea el `source` por URL (+ job `process_source` si es nuevo) y
    crea job `manual_clip` con `at_s` = `currentTime` del `<video>` de la página.

## Fase 4 — Publicación

- OAuth en rutas de la web (`/api/oauth/{platform}/start` y `/callback`, Vercel). Los secretos de
  cada app (Google, TikTok, Meta) van en variables de entorno de Vercel. El callback guarda con el RPC
  `save_social_account(...)` usando la sesión del usuario: el navegador nunca puede leer `social_tokens`.
- Plataformas:
  - `youtube`: YouTube Data API v3, subida reanudable (Shorts = vertical ≤ 60 s + `#shorts`).
  - `tiktok`: Content Posting API. Sin auditoría de la app solo permite borradores/privado: se usa
    `inbox` (el video llega a la app de TikTok para terminar de publicar) o `direct post` si está aprobado.
  - `instagram`: Graph API con cuenta profesional ligada a una página de Facebook; Reels por `video_url`
    (URL firmada de Supabase Storage, 1 h).
  - `facebook`: video/Reel en una página (`page_access_token` en `social_tokens.extra`).
- La web crea filas `publications` (status `queued`, `title`/`caption` finales, `privacy`) y un job
  `publish_clip` payload `{ "publication_ids": ["..."] }`. Si el clip no está renderizado, el worker lo
  renderiza primero. El worker refresca tokens vencidos, sube, actualiza `status`/`progress`/
  `external_url`, y marca la cuenta `expired` si el refresh falla.
