import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { requireAuth, requireUser } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { changePasswordSchema, loginSchema } from './auth.schemas.js';
import * as service from './auth.service.js';

export type AuthRouterOptions = {
  /** Intentos de login por ventana (por defecto, AUTH_RATE_MAX del entorno). */
  rateMax?: number;
};

export function createAuthRouter(options: AuthRouterOptions = {}): Router {
  const authRouter = Router();

  const loginLimiter = rateLimit({
    windowMs: env.AUTH_RATE_WINDOW_MS,
    limit: options.rateMax ?? env.AUTH_RATE_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde.',
      },
    },
  });

  /** POST /api/auth/login */
  authRouter.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
    const data = await service.login(req, res, req.body);
    res.status(200).json({ data });
  });

  /** POST /api/auth/refresh — rota el refresh token (cookie httpOnly). */
  authRouter.post('/refresh', async (req, res) => {
    const data = await service.refresh(req, res);
    res.status(200).json({ data });
  });

  /** POST /api/auth/logout */
  authRouter.post('/logout', async (req, res) => {
    const data = await service.logout(req, res);
    res.status(200).json({ data });
  });

  /** GET /api/auth/me */
  authRouter.get('/me', requireAuth, async (req, res) => {
    const data = await service.me(requireUser(req));
    res.status(200).json({ data });
  });

  /** POST /api/auth/change-password */
  authRouter.post(
    '/change-password',
    requireAuth,
    validateBody(changePasswordSchema),
    async (req, res) => {
      const data = await service.changePassword(requireUser(req), req.body);
      res.status(200).json({ data });
    },
  );

  return authRouter;
}
