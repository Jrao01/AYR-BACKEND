import type { AuthUser } from '../modules/auth/auth.types.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Usuario autenticado (lo inyecta `requireAuth`). */
    user?: AuthUser;
  }
}

export {};
