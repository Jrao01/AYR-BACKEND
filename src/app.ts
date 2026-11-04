import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { rateLimit } from 'express-rate-limit';
import { corsOrigins, env } from './config/env.js';
import { isDbUp, prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { requestId } from './middleware/requestId.js';
import { requireAuth } from './middleware/auth.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { imagesRouter } from './modules/images/images.routes.js';
import { plansAdminRouter, plansPublicRouter } from './modules/plans/plans.routes.js';
import { locationsAdminRouter, locationsPublicRouter } from './modules/locations/locations.routes.js';
import { legalAdminRouter, legalPublicRouter } from './modules/legal/legal.routes.js';
import { contactRouter, contactSubmissionsRouter } from './modules/contact/contact.routes.js';

export type CreateAppOptions = {
  /** Intentos de login por ventana, para tests (por defecto, env AUTH_RATE_MAX). */
  authRateMax?: number;
  /** Peticiones globales por minuto e IP, para tests (por defecto, env GLOBAL_RATE_MAX). */
  globalRateMax?: number;
};

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  app.use(
    pinoHttp({
      logger,
      // Serializadores mínimos: nunca cabeceras (Authorization/Cookie) ni cuerpos.
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = Array.isArray(incoming) ? incoming[0] : incoming;
        const reqId = id && id.length > 0 ? id : randomUUID();
        res.setHeader('x-request-id', reqId);
        return reqId;
      },
    }),
  );
  app.use(requestId);
  app.use(
    helmet({
      // API JSON: no sirve HTML, así que la CSP no aporta (helmet mantiene el
      // resto de cabeceras: X-Frame-Options, nosniff, HSTS en prod, etc.).
      contentSecurityPolicy: false,
      // El frontend consume /uploads desde otro origen (distinto puerto/dominio).
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Límite global por IP: cubre /uploads, /api/health y todo /api. El tope
  // por defecto (GLOBAL_RATE_MAX=300/min) deja /api/health monitoreable.
  app.use(
    rateLimit({
      windowMs: env.GLOBAL_RATE_WINDOW_MS,
      max: options.globalRateMax ?? env.GLOBAL_RATE_MAX,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Demasiadas peticiones; intenta de nuevo en unos segundos' } },
    }),
  );

  // Imágenes servidas desde el volumen (nombre aleatorio => cacheable indefinidamente)
  app.use(
    '/uploads',
    express.static(env.UPLOAD_DIR, {
      index: false,
      dotfiles: 'deny',
      maxAge: '365d',
      immutable: true,
    }),
  );

  app.get('/api/health', async (_req, res) => {
    const up = await isDbUp();
    res.status(up ? 200 : 503).json({
      status: up ? 'ok' : 'degraded',
      db: up ? 'up' : 'down',
      uptime: Math.round(process.uptime()),
      env: env.NODE_ENV,
    });
  });

  app.use('/api/auth', createAuthRouter({ rateMax: options.authRateMax }));

  // Lectura pública (sin token).
  app.use('/api/plans', plansPublicRouter);
  app.use('/api/locations', locationsPublicRouter);
  app.use('/api/legal', legalPublicRouter);
  // Solicitud de preinstalación (formulario público con adjuntos).
  app.use('/api/contact', contactRouter);

  // Todo lo que cuelga de /api/admin exige token de acceso.
  app.use('/api/admin', requireAuth);
  app.use('/api/admin/images', imagesRouter);
  app.use('/api/admin/plans', plansAdminRouter);
  app.use('/api/admin/locations', locationsAdminRouter);
  app.use('/api/admin/legal', legalAdminRouter);
  // Rutas admin de contactos/solicitudes
  app.use('/api/admin/contact-submissions', contactSubmissionsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export async function closeApp(): Promise<void> {
  await prisma.$disconnect();
}
