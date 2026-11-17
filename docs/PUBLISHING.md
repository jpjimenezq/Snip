# Publicación en redes (Fase 4) — guía de configuración

Snip publica en YouTube, TikTok, Instagram y Facebook usando **tus propias apps de desarrollador**
(una por proveedor). Los pasos y nombres de menús de cada consola cambian con frecuencia: úsalos como guía.

Notación: `<dominio>` = el dominio de tu despliegue en Vercel (p. ej. `snip.vercel.app`).

## 0. URIs de redirección (las necesitarás en cada consola)

| Plataforma | Producción | Local |
|------------|------------|-------|
| YouTube (Google) | `https://<dominio>/api/oauth/youtube/callback` | `http://localhost:3000/api/oauth/youtube/callback` |
| TikTok | `https://<dominio>/api/oauth/tiktok/callback` | TikTok **no acepta http://localhost**; usa el dominio de Vercel (o un túnel https) |
| Facebook / Instagram (Meta) | `https://<dominio>/api/oauth/facebook/callback` | `http://localhost:3000/api/oauth/facebook/callback` |

Instagram se conecta con el mismo inicio de sesión de Meta que Facebook (`/api/oauth/instagram/start`
redirige al de Facebook), por eso solo se registra la URI de `facebook`.

## 1. Variables de entorno

**Vercel** (Settings → Environment Variables; solo servidor, **sin** prefijo `NEXT_PUBLIC_` salvo la URL):

| Variable | Para qué |
|----------|----------|
| `NEXT_PUBLIC_APP_URL` | URL base, p. ej. `https://snip.vercel.app` (sin `/` final). Si falta se usa el origen de la petición. Debe coincidir exactamente con las URIs registradas |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | YouTube |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok |
| `META_APP_ID`, `META_APP_SECRET` | Facebook + Instagram |
| `META_SCOPES` (opcional) | Sobrescribe la lista de permisos de Meta (separados por coma) |

**`worker/.env`** (el worker renueva los tokens de Google y TikTok y necesita el secreto):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.
(Meta no hace falta en el worker: los tokens de página no se renuevan.)

Para probar en local, pon las mismas en `web/.env.local`. Mientras falte una variable, la tarjeta de esa
plataforma en **Ajustes → Cuentas conectadas** muestra "No configurado".

Además, la migración `supabase/migrations/0002_live_publish.sql` debe estar aplicada.

## 2. YouTube (Google Cloud)

1. <https://console.cloud.google.com> → crea un proyecto (p. ej. "Snip").
2. **APIs y servicios → Biblioteca** → habilita **YouTube Data API v3**.
3. **Pantalla de consentimiento de OAuth** → tipo **Externo**; nombre de la app, tu correo.
   - Scopes: `.../auth/youtube.upload` y `.../auth/youtube.readonly`.
   - **Usuarios de prueba**: añade tu cuenta de Google (en modo "Testing" solo ellos pueden autorizar).
   - Aviso importante: en modo *Testing* el **refresh token caduca a los 7 días** y tendrás que reconectar. Para
     evitarlo, pulsa **Publicar aplicación** (pasa a "In production"): sin verificación de Google verás la pantalla
     "app no verificada" (Avanzado → continuar) y el límite de 100 usuarios, que para uso personal no importa.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth** → tipo **Aplicación web**.
   - URIs de redirección autorizadas: las de la tabla (producción y local).
   - Copia el ID de cliente y el secreto a `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. Necesitas un **canal de YouTube** en esa cuenta de Google.

**Límites**: la cuota por defecto es 10 000 unidades/día y cada `videos.insert` cuesta 1 600 → **≈6 subidas al día**.
Se amplía solicitando una auditoría/aumento de cuota. Los videos subidos desde una app **no auditada** pueden quedar
bloqueados como *privados* por YouTube hasta pasar la auditoría de API (formulario "YouTube API Services – Audit").
Un clip vertical ≤ 60 s se publica como Short (el worker añade `#shorts` al título).

## 3. TikTok (TikTok for Developers)

1. <https://developers.tiktok.com> → inicia sesión → **Manage apps → Connect an app** (organización o cuenta personal).
2. En la app añade los productos **Login Kit** y **Content Posting API**.
3. Login Kit → **Redirect URI**: `https://<dominio>/api/oauth/tiktok/callback`. Debe ser https y coincidir exacto.
4. Scopes: `user.info.basic`, `video.upload` y `video.publish`. En **Content Posting API** activa **Direct Post** si lo ofrece.
5. Copia **Client key** y **Client secret** a `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
6. **Sandbox**: crea un sandbox y añade tu cuenta de TikTok como *Target user* (en sandbox solo esas cuentas pueden autorizar).
   Para salir de sandbox hay que enviar la app a revisión (demo en video del flujo, política de privacidad y términos).

**Límites / auditoría**: hasta que la app pase la **auditoría de Content Posting API**, todo post directo debe ser
`SELF_ONLY` (privado) y la cuenta debe ser privada. Snip lo maneja así: intenta *direct post* y, si TikTok responde
`unaudited_client_can_only_post_to_private_accounts` (u otro error de scope/auditoría), envía el video a tu
**bandeja** (*inbox*) y marca la publicación como publicada con la nota "Enviado a tu bandeja de TikTok para terminar de
publicar": abre la app de TikTok, ve a las notificaciones/borradores y termina el post. Los access tokens duran 24 h; el
worker los renueva con el refresh token (≈1 año).

## 4. Instagram y Facebook (Meta)

Requisitos previos:
- Una **página de Facebook** de la que seas administrador.
- Para Instagram: cuenta **profesional** (Empresa o Creador) **vinculada a esa página** (Instagram → Configuración → Cuenta → Cambiar a profesional → Página).

Pasos:
1. <https://developers.facebook.com/apps> → **Crear app** → caso de uso "Otro"/"Empresa" (según el asistente), tipo **Empresa**.
2. Añade el producto **Inicio de sesión con Facebook para empresas** (Facebook Login for Business) o **Facebook Login**.
   En su configuración, **URI de redireccionamiento de OAuth válidos**: `https://<dominio>/api/oauth/facebook/callback`
   (y la de localhost si pruebas en local).
3. **Configuración de la app → Básica**: copia **ID de la app** y **Clave secreta** a `META_APP_ID` / `META_APP_SECRET`.
   Añade tu dominio en "Dominios de la app" si lo pide.
4. Permisos que pide Snip: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`,
   `instagram_basic`, `instagram_content_publish`, `business_management` (este último solo hace falta si tu página
   pertenece a un portfolio de Meta Business; puedes quitarlo con `META_SCOPES`).
5. **Modo desarrollo**: mientras la app esté en modo *Development*, todos esos permisos funcionan **sin revisión de app**
   para usuarios con rol en la app (tú como administrador). Añade más cuentas en Roles si hace falta. No necesitas
   "App Review" para uso personal; no pases la app a modo *Live* a menos que quieras publicar con otros usuarios.
6. En **Ajustes → Cuentas conectadas → Facebook o Instagram → Conectar**, marca **todas las páginas** (y la cuenta de
   Instagram si lo pregunta) en el diálogo de Meta. Snip guarda una cuenta por página y otra por cada Instagram vinculado.

**Notas**:
- Instagram Reels necesita una **URL pública** del video: el worker usa una URL firmada de Supabase Storage de 1 hora.
  Instagram solo publica en modo **Público** (privado/no listado se rechaza).
- Facebook: se publica como Reel de la página (`video_reels`); si falla, usa `/{page-id}/videos`. "Privado" guarda un borrador.
- Los *page access tokens* obtenidos con un token de usuario de larga duración **no caducan**, pero se invalidan si cambias
  la contraseña de Facebook o quitas la app: en ese caso la cuenta pasa a "Expirada" y debes reconectar.
- Instagram limita a ~25 publicaciones por API cada 24 h; los Reels deben durar 3–90 s, 9:16.
- La versión de Graph API está en una sola constante (`GRAPH_VERSION` en `worker/snip_worker/platforms/common.py` y
  `META_GRAPH` en `web/src/app/api/oauth/_lib.ts`).

## 5. Probar

1. Despliega (o `npm run dev` con `web/.env.local`), inicia sesión en Snip y abre **Ajustes**.
2. Pulsa **Conectar** en cada plataforma → autoriza → vuelves a `/settings?connected=...`.
3. En un clip, panel **Publicar**: elige cuentas, edita textos y pulsa **Publicar**. El worker (`python -m snip_worker`)
   renderiza el clip si hace falta, sube y actualiza el estado en vivo.

## 6. Problemas frecuentes

| Síntoma | Causa |
|---------|-------|
| `redirect_uri_mismatch` (Google) / "Can't load URL" (Meta) | La URI registrada no coincide exacto con `NEXT_PUBLIC_APP_URL` + `/api/oauth/<plataforma>/callback` |
| YouTube "Acceso bloqueado: no completó la verificación" | No añadiste tu cuenta como usuario de prueba |
| La cuenta de YouTube pasa a "Expirada" a la semana | Consentimiento en modo *Testing* (refresh token de 7 días): publica la app |
| TikTok siempre va a la bandeja | App sin auditar (esperado) |
| Instagram "no se encontró cuenta" | La cuenta no es profesional o no está vinculada a una página que autorizaste |
| `quotaExceeded` | Se acabaron las ~6 subidas diarias de YouTube; se renueva a medianoche (hora del Pacífico) |
