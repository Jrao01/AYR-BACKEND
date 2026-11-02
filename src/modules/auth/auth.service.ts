import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error.js';
import {
  accessTokenTtlSeconds,
  hashToken,
  newRefreshToken,
  signAccessToken,
  ttlToMs,
} from '../../utils/jwt.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import type { LoginInput } from './auth.schemas.js';
import { toPublicUser, type AuthUser, type PublicUser } from './auth.types.js';

type Session = { id: string; token: string };

/**
 * Compara contra un hash inexistente cuando el usuario no existe,
 * para que el tiempo de respuesta no revele si el correo está registrado.
 */
let dummyHash: string | undefined;
async function safeCompare(password: string, stored: string | null | undefined) {
  if (stored) return verifyPassword(password, stored);
  dummyHash ??= await hashPassword('timing-safe-placeholder');
  await verifyPassword(password, dummyHash);
  return false;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: env.NODE_ENV === 'production',
    path: '/api/auth',
  };
}

function setRefreshCookie(res: Response, token: string) {
  res.cookie(env.REFRESH_COOKIE, token, {
    ...cookieOptions(),
    maxAge: ttlToMs(env.JWT_REFRESH_TTL),
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(env.REFRESH_COOKIE, cookieOptions());
}

async function createSession(
  userId: string,
  userAgent: string | undefined,
  ip: string | undefined,
): Promise<Session> {
  const token = newRefreshToken();
  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlToMs(env.JWT_REFRESH_TTL)),
      userAgent: userAgent?.slice(0, 300) ?? null,
      ip: ip ?? null,
    },
  });
  return { id: session.id, token };
}

function issueTokens(sessionId: string, user: { id: string; email: string; role: AuthUser['role'] }) {
  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    sid: sessionId,
  });
  return { accessToken, expiresIn: accessTokenTtlSeconds(accessToken) };
}

export async function login(req: Request, res: Response, input: LoginInput) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await safeCompare(input.password, user?.passwordHash);

  if (!user || !user.active || !valid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
  }

  const session = await createSession(user.id, req.get('user-agent'), req.ip);
  const tokens = issueTokens(session.id, user);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  setRefreshCookie(res, session.token);

  return { ...tokens, user: toPublicUser(user) };
}

export async function refresh(req: Request, res: Response) {
  const raw = req.cookies?.[env.REFRESH_COOKIE];
  if (!raw || typeof raw !== 'string') {
    throw new AppError(401, 'REFRESH_REQUIRED', 'Sesión de refresco requerida');
  }

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });

  const expired = !session || session.expiresAt.getTime() < Date.now();
  if (!session || expired || session.revokedAt || !session.user.active) {
    clearRefreshCookie(res);
    throw new AppError(401, 'REFRESH_INVALID', 'Sesión de refresco inválida o expirada');
  }

  // Rotación atómica: el predicado `revokedAt: null` garantiza que solo una
  // petición concurrente consume el token; la otra obtiene count = 0 y 401.
  const revoked = await prisma.authSession.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count === 0) {
    clearRefreshCookie(res);
    throw new AppError(401, 'REFRESH_INVALID', 'Sesión de refresco inválida o expirada');
  }

  const next = await createSession(session.userId, req.get('user-agent'), req.ip);
  const tokens = issueTokens(next.id, session.user);
  setRefreshCookie(res, next.token);

  return { ...tokens, user: toPublicUser(session.user) };
}

export async function logout(req: Request, res: Response) {
  const raw = req.cookies?.[env.REFRESH_COOKIE];
  if (raw && typeof raw === 'string') {
    await prisma.authSession.updateMany({
      where: { tokenHash: hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  clearRefreshCookie(res);
  return { ok: true };
}

export async function me(user: AuthUser): Promise<PublicUser> {
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || !dbUser.active) {
    throw new AppError(401, 'UNAUTHORIZED', 'Usuario inexistente o inactivo');
  }
  return toPublicUser(dbUser);
}

export async function changePassword(
  user: AuthUser,
  input: { currentPassword: string; newPassword: string },
) {
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || !dbUser.active) {
    throw new AppError(401, 'UNAUTHORIZED', 'Usuario inexistente o inactivo');
  }

  const valid = await verifyPassword(input.currentPassword, dbUser.passwordHash);
  if (!valid) {
    throw new AppError(401, 'INVALID_PASSWORD', 'La contraseña actual no es correcta');
  }

  await prisma.user.update({
    where: { id: dbUser.id },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });

  // Revoca el resto de sesiones; conserva solo la que hizo el cambio.
  const revoked = await prisma.authSession.updateMany({
    where: { userId: dbUser.id, revokedAt: null, NOT: { id: user.sid } },
    data: { revokedAt: new Date() },
  });

  return { ok: true, revokedSessions: revoked.count };
}
