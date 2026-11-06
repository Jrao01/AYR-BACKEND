import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/error.js';

/**
 * Almacenamiento privado de los adjuntos de una solicitud de preinstalación.
 *
 * Los archivos viven fuera de `UPLOAD_DIR` a propósito: son documentos
 * personales y nunca deben servirse desde `/uploads`. El panel los lee por
 * `GET /api/admin/contact-submissions/:id/attachments/:kind`.
 */

export const CONTACT_UPLOAD_DIR = path.resolve(env.CONTACT_UPLOAD_DIR);

fs.mkdirSync(CONTACT_UPLOAD_DIR, { recursive: true, mode: 0o700 });

/** Extensiones que aceptamos (incluye HEIC/HEIF, típico de iPhone). */
const EXT_MIME = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
]);

const ALLOWED_EXT = new Set(EXT_MIME.keys());

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CONTACT_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ALLOWED_EXT.has(ext) ? ext : '.bin'}`);
  },
});

export const contactUpload = multer({
  storage,
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: 3,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype.startsWith('image/') || ALLOWED_EXT.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new AppError(400, 'ARCHIVO_INVALIDO', 'Solo se permiten imágenes (JPG, PNG, WEBP o HEIC).'));
  },
});

/** Todos los archivos que Multer llegó a escribir en esta petición. */
export function uploadedFiles(req: Express.Request): Express.Multer.File[] {
  const byField = req.files as Record<string, Express.Multer.File[]> | undefined;
  if (!byField) return [];
  return Object.values(byField).flat();
}

/** Borra archivos recién subidos; nunca deja que un fallo de limpieza rompa la petición. */
export async function cleanupFiles(files: Express.Multer.File[] | undefined | null): Promise<void> {
  if (!files?.length) return;
  await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => undefined)));
}

/**
 * Convierte el nombre guardado en BD en una ruta absoluta segura.
 * Devuelve `null` si el nombre intenta salir del directorio privado.
 */
export function resolveStoredFile(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const base = path.basename(fileName);
  if (base !== fileName) return null;
  const full = path.resolve(CONTACT_UPLOAD_DIR, base);
  if (!full.startsWith(`${CONTACT_UPLOAD_DIR}${path.sep}`)) return null;
  return full;
}

/** `true` si el nombre está guardado en BD y el archivo existe en disco. */
export function storedFileExists(fileName: string | null | undefined): boolean {
  const full = resolveStoredFile(fileName);
  return full !== null && fs.existsSync(full);
}

/** Borra un adjunto persistido (mejor esfuerzo). */
export async function deleteStoredFile(fileName: string | null | undefined): Promise<void> {
  const full = resolveStoredFile(fileName);
  if (!full) return;
  await fs.promises.unlink(full).catch(() => undefined);
}

/** MIME a partir de la extensión del archivo guardado. */
export function mimeForStoredFile(fileName: string): string {
  return EXT_MIME.get(path.extname(fileName).toLowerCase()) ?? 'application/octet-stream';
}
