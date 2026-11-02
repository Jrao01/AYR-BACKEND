import type { RequestHandler } from 'express';

/** Propaga el id que genera pino-http a la cabecera de respuesta. */
export const requestId: RequestHandler = (req, res, next) => {
  const id = (req as unknown as { id?: unknown }).id;
  if (typeof id === 'string' && id.length > 0) {
    res.setHeader('x-request-id', id);
  }
  next();
};
