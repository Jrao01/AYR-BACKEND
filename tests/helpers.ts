import request from 'supertest';
import type { Express } from 'express';
import { env } from '../src/config/env.ts';

export function adminCredentials(): { email: string; password: string } {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error('Faltan ADMIN_EMAIL/ADMIN_PASSWORD en .env (requerido para los tests)');
  }
  return { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD };
}

/** Devuelve un access token válido para el administrador sembrado. */
export async function login(app: Express): Promise<string> {
  const { email, password } = adminCredentials();
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login de prueba falló: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken as string;
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function uniqueKey(prefix = 'test'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
