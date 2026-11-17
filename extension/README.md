# Snip — extensión de Chrome

Atajo **Alt+Shift+S** para crear un clip de lo que estás viendo (directo o VOD) sin salir de la página.

## Instalar (modo desarrollador)

1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. Pulsa **Cargar descomprimida** y elige esta carpeta (`extension/`).
3. Se abre la página de opciones (si no: clic derecho en el icono > Opciones).

## Configurar

En las opciones escribe:

- **URL de Supabase** y **Anon key**: en Supabase > Project Settings > API (la misma pareja que usa `web/.env.local`).
- **Correo y contraseña** del usuario de Snip. La contraseña solo se usa para iniciar sesión; se guardan los tokens
  (access/refresh) en `chrome.storage.local` y se renuevan solos. Nunca se guarda la contraseña.
- **URL del panel**: tu despliegue de Vercel (para el enlace "Abrir Snip").

Pulsa **Guardar e iniciar sesión**.

## Atajos

- Predeterminado: **Alt+Shift+S** (también el icono de la barra). Si no funciona o choca con otro,
  cámbialo en `chrome://extensions/shortcuts`.
- En el panel flotante: teclas **1–6** = 5/10/15/30/45/60 s, **Enter** = 30 s, **Esc** = cerrar,
  o el botón **Personalizado**.

## Qué hace

- **Directo** (Kick `/canal`, Twitch `/canal`, YouTube en vivo): crea un job `live_clip`. La hora se toma al
  pulsar el atajo (no al elegir la duración). El worker corta ese tramo de su búfer. Requiere que el worker esté
  grabando el canal; la primera vez lo añade a la lista y falla con un aviso: repite en unos segundos.
- **VOD / video de YouTube** (`kick.com/video/...`, `twitch.tv/videos/...`, `watch?v=`): busca o crea la fuente,
  y crea un `manual_clip` que termina en el segundo actual del reproductor.

Si algo falla verás una notificación de Chrome con el motivo.
