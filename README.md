# AYR Backend

API de la página informativa de **AYR NETWORK XV C.A.**: planes, ubicaciones del mapa, imágenes y documentos legales (términos + privacidad con fechas de modificación auditadas).

> Plan completo por fases: [`../plan-backend.md`](../plan-backend.md).
> **Estado: fases F0, F1, F2 y F3 implementadas y verificadas.** Siguientes: F4 (planes), F5 (ubicaciones), F6 (legal), F7 (endurecimiento), F8 (corte de `web/src/data`), F9 (despliegue).

## Stack

Express 5 · TypeScript · Prisma 7 + PostgreSQL 16 · JWT (access + refresh con rotación) · multer (subidas a volumen) · zod · helmet/cors/rate-limit · pino · Docker multi-etapa · vitest + supertest.

## Puesta en marcha (desarrollo local)

```bash
cp .env.example .env        # y rellena DATABASE_URL, JWT_* y ADMIN_*
docker compose up -d db     # solo PostgreSQL
npm install
npm run db:migrate          # crea el esquema
npm run seed                # importa web/src/data/* + imágenes a uploads/
npm run dev                 # API en http://localhost:4000
```

El seed **se ejecuta desde la host** porque importa directamente `web/src/data/{plans,offices,legal}.ts`; es idempotente (se puede repetir sin duplicar nada).

### Todo en Docker

```bash
docker compose up --build -d
curl -s localhost:4000/api/health   # {"status":"ok","db":"up",...}
```

El contenedor `api` ejecuta `prisma migrate deploy` al arrancar. Las imágenes viven en el volumen `uploads` y sobreviven a `docker compose down && up`.

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor con recarga (tsx watch) |
| `npm run build` | `prisma generate` + `tsc` → `dist/` |
| `npm start` | Ejecuta `dist/server.js` (producción) |
| `npm run typecheck` | `tsc --noEmit` (incluye prisma/scripts/tests) |
| `npm run lint` | oxlint |
| `npm test` | vitest (requiere `db` arriba + `npm run seed`) |
| `npm run seed` | Sembrado idempotente + copia de imágenes a `uploads/` |
| `npm run images:sync` | Solo copia/registra `web/public/{imgs,docs}` |
| `npm run email:otp` | Envía el correo OTP de 8 dígitos (ver [Correo OTP](#correo-otp-via-resend)) |
| `npm run db:migrate` | Migración nueva en desarrollo |
| `npm run db:studio` | Prisma Studio |

## Endpoints

**Públicos**

| Método | Ruta |
|---|---|
| GET | `/api/health` |
| GET | `/api/plans` (solo activos, orden `order`; `id` = slug) |
| GET | `/api/locations?type=office\|future` (activas; `coords: [lat, lng]`; `id` = slug) |
| GET | `/api/legal` (índice de documentos publicados) |
| GET | `/api/legal/:slug` (documento publicado + secciones; `paragraphs`/`list` ausentes si están vacíos) |
| GET | `/uploads/:folder/:fileName` (estático, cache 1 año) |

**Auth**

| Método | Ruta | Notas |
|---|---|---|
| POST | `/api/auth/login` | access JWT (15 m) + refresh cookie httpOnly (7 d). Rate limit por IP |
| POST | `/api/auth/refresh` | rota la sesión |
| POST | `/api/auth/logout` | revoca la sesión |
| GET | `/api/auth/me` | perfil |
| POST | `/api/auth/change-password` | revoca las demás sesiones |

**Admin** (Bearer access token)

| Método | Ruta |
|---|---|
| GET | `/api/admin/images` |
| POST | `/api/admin/images/upload?folder=imgs\|docs` (multipart `file`, `key?`, `alt?`) |
| PATCH | `/api/admin/images/:id` |
| DELETE | `/api/admin/images/:id` (409 si una ubicación la referencia) |
| GET | `/api/admin/plans` (todos, incluidos inactivos) |
| POST | `/api/admin/plans` |
| PATCH | `/api/admin/plans/:idOrSlug` |
| DELETE | `/api/admin/plans/:idOrSlug` (soft delete: `active=false`) |
| GET | `/api/admin/locations` |
| POST | `/api/admin/locations` (`office` exige `address` + `phone`) |
| PATCH | `/api/admin/locations/:idOrSlug` |
| DELETE | `/api/admin/locations/:idOrSlug` (soft delete: `active=false`) |
| GET | `/api/admin/legal/:slug` (borrador + estado + `hasUnpublishedChanges`) |
| PUT | `/api/admin/legal/:slug` (guarda secciones; **no** toca `lastModifiedAt`) |
| POST | `/api/admin/legal/:slug/publish` (transaccional: versión+1, sella fechas y crea revisión) |
| GET | `/api/admin/legal/:slug/history` |

Formato de respuesta: `{ data }` / `{ error: { code, message, details? } }`.

En los DTO **públicos** de planes y ubicaciones, `id` es el `slug` (p. ej. `hogar-1`, `miranda`): coincide con los identificadores que ya usaba el frontend estático. En los DTO de admin, `dbId` es el id real (cuid) y `:idOrSlug` acepta cualquiera de los dos.

## Reglas de subida de imágenes

- Extensiones: `jpg, jpeg, png, webp, gif, svg` (validadas por extensión **y** por magic bytes; el SVG se valida por cabecera).
- Límite `MAX_UPLOAD_MB` (5 MB en `.env`; los tests usan 1 MB).
- Carpeta por query (`imgs` | `docs`), nunca por nombre de archivo → sin path traversal.
- Nombre en disco aleatorio (`<uuid>.<ext>`); la identidad lógica es el campo `key` (kebab-case, única; duplicada → 409 `KEY_DUPLICADA`).

## Flujo legal (borrador → publicar)

- Las secciones son de **copia única**: `PUT` guarda el borrador y el público pasa a ver ese contenido, pero la fecha "Última modificación" **no** avanza.
- `POST /publish` sella el cambio: `version+1`, `lastModifiedAt`/`publishedAt` = ahora y una fila `LegalRevision` (con `summary` opcional y el usuario). Todo dentro de una transacción.
- `hasUnpublishedChanges` (DTO admin) = hay cambios sin sellar (`updatedAt > lastModifiedAt`).

## Endurecimiento (F7)

- Rate limit: global suave `GLOBAL_RATE_MAX` (300/min por IP) + estricto en `/api/auth` (`AUTH_RATE_MAX`).
- `helmet` sin CSP (API JSON; mantiene el resto de cabeceras) y CORS con whitelist `CORS_ORIGINS` (sin `Access-Control-Allow-Origin` para orígenes ajenos).
- Logs pino con serializadores mínimos (método/url/status + requestId) y redacción de `authorization`, `cookie`, `set-cookie`, contraseñas y tokens: nunca se imprimen secretos.
- Errores Prisma mapeados: `P2002`→409, `P2025`→404, `P2003`→409; el resto → 500 genérico sin stack en producción.
- **Deuda técnica:** optimización de imágenes con `sharp` (ancho máx. 1600 + thumb) pendiente; se omite por ahora para no complicar el Dockerfile multi-etapa.

## Variables de entorno

Ver [`.env.example`](.env.example). Obligatorias: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (≥16 caracteres). El usuario admin solo se crea si `ADMIN_EMAIL` + `ADMIN_PASSWORD` están definidos y no existe aún. Opcional: `RESEND_API_KEY` (solo la usa el script de correo OTP).

## Correo OTP vía Resend

Script independiente para enviar el correo de **código OTP de 8 dígitos** con la identidad visual de
AYR (logo blanco sobre azul `#092745`, paleta de `web/src/styles/tokens.css`).

```bash
cd AYR-BACKEND

# 1) Edita el bloque CONFIG de utils/send-email.ts (destinatario, código, API key)
#    o exporta RESEND_API_KEY=re_... y pasa los datos por flags.

# 2) Vista previa del HTML (no envía nada) → abre el archivo en el navegador
npx tsx utils/send-email.ts --dry-run --preview /tmp/otp.html --code 48291357

# 3) Envío real
npx tsx utils/send-email.ts --to correo@destino.com --code 48291357
npm run email:otp   # equivalente, usando la configuración de código
```

| Flag | Descripción |
|---|---|
| `--to <correo>` | Destinatario |
| `--code <8 dígitos>` | Código OTP |
| `--api-key <re_...>` | API key (o variable `RESEND_API_KEY`) |
| `--name <nombre>` | Nombre para el saludo |
| `--expires <min>` | Minutos de validez (10 por defecto) |
| `--purpose <texto>` | Propósito del código |
| `--action-url` / `--action-label` | Botón opcional (con fallback VML para Outlook) |
| `--dry-run` / `--preview <ruta>` | Genera el HTML/TXT sin enviar |
| `--help` | Ayuda |

### Banco de pruebas de entregabilidad

`utils/send-email-smtp.ts` envía **el mismo contenido** por distintos transportes para aislar
qué variable provoca la caída en spam. Cada escenario usa la plantilla OTP idéntica; lo único
que cambia es el camino del mensaje.

```bash
# A) API de Resend (línea base) — llega a Inbox
RESEND_API_KEY=re_... npx tsx utils/send-email-smtp.ts --scenario resend-api --to correo@x.com --code 48291357

# B) SMTP directo a Resend (smtp.resend.com:587)
RESEND_API_KEY=re_... npx tsx utils/send-email-smtp.ts --scenario resend-smtp --to correo@x.com --code 48291357

# C) SMTP a Stalwart (mail.ayrnetworxv.ve) — aísla el relay corporativo
STALWART_PASS=... npx tsx utils/send-email-smtp.ts --scenario stalwart --host mail.ayrnetworxv.ve --port 465 --to correo@x.com --code 48291357

# D) Genera el .eml para abrir y enviar desde Thunderbird
npx tsx utils/send-email-smtp.ts --scenario eml --eml /tmp/ayr-otp.eml --code 48291357
```

| Escenario | Variable que aísla |
|---|---|
| `resend-api` | Línea base (solo API) |
| `resend-smtp` | API vs SMTP de Resend |
| `stalwart` | ¿El relay de Stalwart degrada la entrega? |
| `eml` | ¿El cliente de origen (Thunderbird) degrada la entrega? |

**Cómo interpretar el resultado:** si `resend-api` y `resend-smtp` llegan a Inbox pero
`stalwart` cae en Spam, el problema es el relay (SPF/DKIM/IP de salida de Stalwart), no la
plantilla. Si `stalwart` también llega a Inbox, el culpable es el cliente o el camino previo.

### Plantilla y peso del mensaje

- `utils/email/eml.ts` construye el MIME completo (`multipart/alternative` con `text/plain` +
  `multipart/related` con el HTML y el logo inline vía `cid:`), equivalente a lo que produce
  la API de Resend. Se reutiliza para SMTP y para el `.eml` de Thunderbird.
- `utils/email/smtp.ts` es un cliente SMTP mínimo **sin dependencias**: TLS implícito (465),
  STARTTLS (587), `AUTH PLAIN`/`LOGIN`.
- El logo del correo (`utils/email/assets/ayr-logo-blanco.png`) está optimizado a **400×155 px
  cuantizado (5.8 KB)** frente al original de 900×349 px (61.4 KB). Con el original el mensaje
  completo pesaba 100.9 KB (98.9% del límite de recorte de Gmail); ahora pesa **~24.8 KB**.


**Requisitos en Resend:** el dominio `ayrnetworxv.ve` debe estar verificado (SPF, DKIM y DMARC en
Cloudflare) para poder usar `AyrNetworx <admin@ayrnetworxv.ve>` como remitente.

**Detalles de implementación**

- El logo se incrusta como adjunto inline (`content_id` → `cid:ayr-logo`); Gmail no renderiza
  `data:` URIs, por eso no se usa base64 dentro del HTML.
- Se envían las dos versiones: `html` y `text` (sin `text`, Resend autogenera mal el plano).
- Tono estrictamente transaccional: sin eslogan ni texto promocional en la plantilla, y asunto
  neutro sin signos de exclamación (el contenido publicitario penaliza la entrega en la bandeja).
- Guarda de tamaño: si el HTML supera ~102 KB (`GMAIL_CLIP_BYTES`) se rechaza antes de llamar a la
  API (`message_too_large`), porque Gmail recorta esos mensajes. El CLI muestra el peso del HTML.
- `Idempotency-Key` por envío: reintentar en el mismo minuto no duplica el correo.
- Errores mapeados por `statusCode` de la API (401 API key, 403 dominio no verificado, 422 payload,
  429 cuota) y salida con `exit 1` cuando el envío falla.

**Checklist antes del primer envío real**

1. Dominio `ayrnetworxv.ve` verificado en Resend (SPF, DKIM y DMARC en Cloudflare); sin eso,
   `invalid_from_address`.
2. Prueba con `delivered@resend.dev` (Resend lo intercepta) y luego con cuentas reales de Gmail,
   Outlook y Yahoo. En Gmail abre "Mostrar original" y confirma `spf=pass`, `dkim=pass` y
   `dmarc=pass`.
3. Mide el puntaje con [mail-tester.com](https://www.mail-tester.com) (objetivo ≥ 9/10).
4. Calienta el dominio: es nuevo y no tiene reputación. Empieza con pocos envíos al día a
   destinatarios que interactúan y sube el volumen gradualmente (plan gratuito: 100 correos/día).
5. Envía el OTP solo cuando el usuario lo acaba de solicitar; un código no esperado parece spam.
6. Confirma en la salida del CLI que el HTML pesa mucho menos de 102 KB (hoy ~9.4 KB).

## Estructura

```
prisma/schema.prisma    modelos (ver ANEXO A del plan)
prisma/seed.ts          importa prisma/seed-content.ts → BD
prisma/seed-content.ts  contenido de arranque (planes, oficinas, legales)
scripts/sync-images.ts  copia web/public/{imgs,docs} → uploads/ + ImageAsset
utils/send-email.ts     CLI del correo OTP (config por código + flags)
utils/email/            brand.ts (paleta/datos/logo) · otp.template.ts · email.service.ts
src/config              env validado con zod
src/lib                 prisma (adapter pg), logger (pino)
src/middleware          auth, error, requestId, validate
src/modules/{auth,images,plans,locations,legal}/
src/app.ts              createApp()  ·  src/server.ts
uploads/                imágenes (bind mount, gitignored)
```

## Notas de implementación (desviaciones del plan)

1. **Express 5**: no hace falta `asyncHandler`; las promesas rechazadas caen en el handler de errores.
2. **Prisma 7**: config en `prisma7.config.ts`, client generado en `src/generated/prisma` (gitignored) y conexión vía `@prisma/adapter-pg`.
3. **Listas opcionales**: Prisma no las admite; `paragraphs[]`/`list[]` usan `[]` = "sin contenido".
4. **Node 24** en el Dockerfile (vitest 5 / toolchain actual exigen ≥22.12).
5. **`validateBody`** solo valida `query`/`params` dentro del handler (Express 5 expone `req.query` como getter).
6. **Seed en la host**, no en el contenedor: importa archivos de `web/` que quedan fuera del build context.
7. Contadores reales del seed: **7 planes, 4 ubicaciones, 2 documentos legales, 27 secciones, 16 imágenes, 1 admin**.
