import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/** Valida y reemplaza `req.body` con la versión parseada por zod. */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}
