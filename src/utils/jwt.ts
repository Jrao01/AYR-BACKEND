import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import type { AuthUser } from '../modules/auth/auth.types.js';
import type { Role } from '../generated/prisma/enums.js';

type AccessPayload = {
  sub?: string;
  email?: string;
  role?: Role;
  sid?: string;
  typ?: string;
  iat?: number;
  exp?: number;
};

export function signAccessToken(user: AuthUser): string {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    sid: user.sid,
    typ: 'access',
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AuthUser {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
  if (typeof decoded === 'string' || decoded.typ !== 'access') {
    throw new Error('Tipo de token inválido');
  }
  if (!decoded.sub || !decoded.email || !decoded.role || !decoded.sid) {
    throw new Error('Payload de token incompleto');
  }
  return { id: decoded.sub, email: decoded.email, role: decoded.role, sid: decoded.sid };
}

/** Segundos de validez del access token recién emitido (para el cliente). */
export function accessTokenTtlSeconds(token: string): number {
  const decoded = jwt.decode(token) as AccessPayload | null;
  if (decoded?.exp && decoded.iat) return decoded.exp - decoded.iat;
  return 0;
}

export function newRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Convierte TTLs estilo "15m" / "7d" / "3600" a milisegundos. */
export function ttlToMs(ttl: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(ttl.trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2] || 's';
  const factor: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (factor[unit] ?? 1000);
}
