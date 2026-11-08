import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(2000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET debe tener al menos 16 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET debe tener al menos 16 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  REFRESH_COOKIE: z.string().default('ayr_rt'),
  AUTH_RATE_MAX: z.coerce.number().int().min(1).default(10),
  AUTH_RATE_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  // Límite global suave por IP (la API es interna; /auth tiene el suyo estricto).
  GLOBAL_RATE_MAX: z.coerce.number().int().min(1).default(300),
  GLOBAL_RATE_WINDOW_MS: z.coerce.number().int().min(1000).default(60 * 1000),

  CORS_ORIGINS: z.string().optional(),

  UPLOAD_DIR: z.string().default('./uploads'),
  // Directorio con las imágenes base a sembrar ({imgs,docs}). Si no se define,
  // se busca automáticamente en ../web/public (monorepo) o seed-assets
  // (imagen Docker). Nunca sustituye a las imágenes subidas por el panel.
  PUBLIC_ASSETS_DIR: z.string().optional(),
  // Documentos privados de las solicitudes (cédula y comprobante). Nunca se
  // sirven desde /uploads: solo por el endpoint autenticado del panel.
  CONTACT_UPLOAD_DIR: z.string().default('./contact-uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),

  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),

  // Sembrado automático al arrancar: crea el admin de .env si no hay usuarios
  // y ejecuta el seed si falta cualquiera de las tablas base.
  AUTO_SEED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((value) => value === 'true' || value === '1'),

  // Wisphub: por defecto apunta a producción. El sandbox
  // (https://sandbox-api.wisphub.net/...) devuelve 502 a solicitudes válidas.
  WISPHUB_API_URL: z.url().default('https://api.wisphub.co/api/solicitar-instalacion/'),
  WISPHUB_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Variables de entorno inválidas:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

/**
 * Normaliza los orígenes de CORS que vienen del `.env`:
 *  - recorta espacios y quita barras finales;
 *  - añade `https://` cuando falta el esquema;
 *  - descarta entradas inválidas.
 *
 * `cors` compara el header `Origin` de forma literal, así que
 * `https://ayrnetworxv.ve/`, `ayrnetworxv.ve` y `https://ayrnetworxv.ve`
 * deben terminar todos como `https://ayrnetworxv.ve`.
 *
 * En producción la variable es obligatoria: si no queda ningún origen válido
 * el proceso no arranca, en lugar de aceptar o rechazar orígenes sin avisar.
 */
function parseCorsOrigins(raw: string | undefined): string[] {
  const normalized = new Set<string>();

  for (const entry of (raw ?? '').split(',')) {
    let value = entry.trim().replace(/\/+$/, '');
    if (!value) continue;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      // El header Origin nunca incluye path ni barra final.
      normalized.add(`${url.protocol}//${url.host}`);
    } catch {
      // Entrada inválida: se ignora y se avisa abajo.
    }
  }

  if (normalized.size === 0) {
    if (env.NODE_ENV === 'production') {
      console.error('CORS_ORIGINS no contiene ningún origen válido (obligatoria en producción)');
      process.exit(1);
    }
    normalized.add('http://localhost:5173');
  }

  return [...normalized];
}

export const corsOrigins: string[] = parseCorsOrigins(env.CORS_ORIGINS);
