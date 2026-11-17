# Snip — panel web

Next.js (App Router) + Tailwind + Supabase. No procesa video: solo lee/escribe filas de Supabase y crea `jobs`
que el worker de Python (en tu PC) ejecuta. Contratos y esquema: `../docs/ARCHITECTURE.md` y `../supabase/migrations/0001_init.sql`.

## Desarrollo local

1. Ejecuta la migración `supabase/migrations/0001_init.sql` en Supabase > SQL Editor.
2. En Supabase > Authentication > Users, crea tu usuario (correo + contraseña). La app no tiene registro.
3. Copia las variables:
   ```bash
   cd web
   cp .env.example .env.local
   ```
   y rellena `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings > API).
4. Instala y arranca:
   ```bash
   npm install
   npm run dev
   ```
   Abre http://localhost:3000 e inicia sesión.
5. Comprobaciones: `npm run lint` y `npm run build`.

## Despliegue en Vercel

1. Sube el repositorio a GitHub e impórtalo en Vercel.
2. **Root Directory = `web`**. Framework: Next.js (se detecta solo).
3. En Settings > Environment Variables añade `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy. En Supabase > Authentication > URL Configuration pon la URL de Vercel como Site URL.

## PWA y compartir desde el celular

Instala la app desde el navegador (Chrome/Android: "Instalar app"). Una vez instalada aparece "Snip" en el menú
de compartir: compartir un enlace de YouTube/Kick/Twitch abre `/share`, que muestra el enlace y un botón "Procesar".
Si no hay sesión, se redirige a `/login` y se vuelve a `/share` con el enlace conservado.

## Notas

- Next 16: el antiguo `middleware.ts` se llama `src/proxy.ts` (usa `src/lib/supabase/middleware.ts`).
- Las vistas previas/frames/finales se leen con URLs firmadas del bucket privado `clips`.
- Los estados se actualizan en vivo con Supabase Realtime (tablas `sources`, `clips`).

## Modo demo (sin Supabase)

Para ver toda la interfaz con datos de ejemplo, sin login ni base de datos:

```bash
npm run dev:demo
```

Los datos viven en memoria (se reinician al recargar) y los procesos (descarga,
transcripción, render) se simulan. Los videos de ejemplo de `public/demo/` se generan
con el motor de render real: `worker/.venv/Scripts/python web/scripts/make-demo-media.py`.
