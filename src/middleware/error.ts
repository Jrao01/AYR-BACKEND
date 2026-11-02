import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` },
  });
};

function prismaErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null;
}

function multerMessage(code: string | undefined): string {
  switch (code) {
    case 'LIMIT_FILE_SIZE':
      return `Archivo demasiado grande (máximo ${env.MAX_UPLOAD_MB} MB)`;
    case 'LIMIT_FILE_COUNT':
      return 'Solo se permite un archivo por petición';
    case 'LIMIT_UNEXPECTED_FILE':
      return 'Campo de archivo inesperado';
    default:
      return 'Error al subir el archivo';
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Error interno del servidor';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Datos inválidos';
    details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  } else if (prismaErrorCode(err) === 'P2002') {
    status = 409;
    code = 'CONFLICT';
    message = 'Ya existe un registro con esos datos';
  } else if (prismaErrorCode(err) === 'P2025') {
    status = 404;
    code = 'NOT_FOUND';
    message = 'Registro no encontrado';
  } else if (prismaErrorCode(err) === 'P2003') {
    status = 409;
    code = 'REFERENCE_ERROR';
    message = 'Operación no permitida: el registro está referenciado';
  } else if ((err as { name?: string } | undefined)?.name === 'MulterError') {
    status = 400;
    code = 'UPLOAD_ERROR';
    message = multerMessage((err as { code?: string }).code);
  } else if ((err as { type?: string } | undefined)?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'JSON malformado en el cuerpo de la petición';
  }

  const reqId = (req as unknown as { id?: string }).id;
  const logPayload = { err, reqId, status, code, path: req.originalUrl, method: req.method };

  if (status >= 500) {
    logger.error(logPayload, message);
  } else {
    logger.warn(logPayload, message);
  }

  res.status(status).json({
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  });
};
