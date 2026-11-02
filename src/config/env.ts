import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
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

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),

  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
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

export const corsOrigins: (string | RegExp)[] = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
