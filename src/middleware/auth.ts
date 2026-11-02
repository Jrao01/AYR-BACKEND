import type { Request, RequestHandler } from 'express';
import { AppError } from './error.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../utils/jwt.js';
import type { AuthUser } from '../modules/auth/auth.types.js';

function bearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req.headers.authorization);
  if (!token) {
    next(new AppError(401, 'UNAUTHORIZED', 'Token de acceso requerido'));
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    // Verificación de estado en servidor: la sesión (sid) debe seguir activa
    // y el usuario habilitado; si no, la revocación no tendría efecto hasta
    // que el access token expirara (JWT_ACCESS_TTL).
    const session = await prisma.authSession.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now() ||
      !session.user.active
    ) {
      next(new AppError(401, 'UNAUTHORIZED', 'Sesión revocada o usuario inactivo'));
      return;
    }
    req.user = {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
      sid: session.id,
    };
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError(401, 'UNAUTHORIZED', 'Token de acceso inválido o expirado'));
  }
};

/** Devuelve el usuario inyectado por `requireAuth` (o lanza 401). */
export function requireUser(req: Request): AuthUser {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Token de acceso requerido');
  }
  return req.user;
}
