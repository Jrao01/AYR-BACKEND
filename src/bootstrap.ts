import { env } from './config/env.js';
import { isDbUp, prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { hashPassword } from './utils/password.js';
import { seed } from './seed/seed.js';

const DB_WAIT_RETRIES = 10;
const DB_WAIT_DELAY_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForDb(): Promise<boolean> {
  for (let attempt = 1; attempt <= DB_WAIT_RETRIES; attempt += 1) {
    if (await isDbUp()) return true;
    if (attempt < DB_WAIT_RETRIES) {
      logger.warn({ attempt, retries: DB_WAIT_RETRIES }, 'BD no disponible; reintentando bootstrap');
      await sleep(DB_WAIT_DELAY_MS);
    }
  }
  return false;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Crea el administrador definido en .env si todavía no hay ningún usuario.
 * Idempotente y tolerante a arranques concurrentes (P2002 = otro proceso ganó).
 */
export async function ensureAdmin(): Promise<boolean> {
  const users = await prisma.user.count();
  if (users > 0) return false;

  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    logger.warn(
      'No hay usuarios y ADMIN_EMAIL/ADMIN_PASSWORD no están definidos; no se crea el administrador',
    );
    return false;
  }

  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  try {
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(env.ADMIN_PASSWORD),
        name: 'Administrador',
        role: 'ADMIN',
      },
    });
    logger.info({ email }, 'Usuario administrador creado desde .env');
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** true si falta cualquiera de las tablas base (seed nunca ejecutado o parcial). */
export async function isSeedNeeded(): Promise<boolean> {
  const [plans, locations, documents] = await Promise.all([
    prisma.plan.count(),
    prisma.mapLocation.count(),
    prisma.legalDocument.count(),
  ]);
  return plans === 0 || locations === 0 || documents === 0;
}

/**
 * Bootstrap de arranque: espera a la BD, crea el admin si no hay usuarios y
 * ejecuta el seed idempotente si la base está vacía o incompleta.
 */
export async function bootstrapDatabase(): Promise<void> {
  if (!env.AUTO_SEED) {
    logger.info('AUTO_SEED desactivado; se omite el bootstrap de la base de datos');
    return;
  }

  if (!(await waitForDb())) {
    logger.error('Base de datos no disponible tras los reintentos; bootstrap omitido');
    return;
  }

  await ensureAdmin();

  if (!(await isSeedNeeded())) {
    logger.info('Datos iniciales presentes; seed omitido');
    return;
  }

  logger.info('Base de datos vacía o incompleta; ejecutando seed inicial');
  await seed();
  logger.info('Seed inicial completado');
}
