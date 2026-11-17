# ✂️ Snip

Tu fábrica personal de clips: pega un enlace de YouTube o de un directo de Kick/Twitch,
Snip lo transcribe con Whisper en tu PC, la IA encuentra los momentos con más potencial
viral y los conviertes en clips verticales con subtítulos listos para TikTok, Reels y Shorts.

- **web/** — panel (Next.js) desplegado en Vercel. Funciona en PC y celular (instalable como app).
- **worker/** — motor que corre en tu PC con la GPU: descarga, transcribe, analiza y renderiza.
- **supabase/** — esquema de la base de datos.
- **docs/ARCHITECTURE.md** — cómo encaja todo.

## Puesta en marcha (una sola vez)

### 1. Supabase (gratis)
1. Crea un proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor** → pega y ejecuta `supabase/migrations/0001_init.sql`.
3. **Authentication → Users → Add user**: crea tu usuario (correo + contraseña).
4. **Project Settings → API**: copia `Project URL`, `anon key` y `service_role key`.

### 2. Anthropic (la IA que elige los momentos y escribe los copies)
1. Entra a [console.anthropic.com](https://console.anthropic.com) → **Billing** → recarga
   (con **5 USD** alcanza para muchísimos directos).
2. **API Keys → Create Key**.
3. Pégala en `worker/.env` en la línea `ANTHROPIC_API_KEY=`.
   La clave **solo** va en el worker (tu PC). Nunca en Vercel ni en el repositorio.

### 3. Worker (tu PC)
Ver `worker/README.md`. En resumen: copia `worker/.env.example` → `worker/.env`,
llena los valores, instala dependencias y ejecuta `worker/run.ps1`.

### 4. Web (Vercel)
Ver `web/README.md`. En resumen: importa el repo en Vercel con **Root Directory = `web`**
y agrega `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Uso
1. Abre el panel, pega un enlace → el worker (con tu PC prendido) lo procesa.
2. Revisa los clips sugeridos por la IA (o crea uno manual: momento + 5/10/15/30/45/60 s).
3. Ajusta el encuadre (llenar, ajustar con fondo o dividir en dos) y el estilo de subtítulos.
4. **Renderizar** → descarga el clip y copia el título/copy para cada red.

En el celular: comparte un video desde la app de YouTube → **Snip**.

## Hoja de ruta
- [x] Fase 1: enlaces → transcripción → momentos IA → editor → render 9:16 + copies
- [ ] Fase 2: zoom y seguimiento automático de caras
- [ ] Fase 3: extensión de Chrome con atajo + clip en vivo
- [ ] Fase 4: publicar directo en TikTok, Instagram, Facebook y YouTube
