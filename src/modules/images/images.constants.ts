import { AppError } from '../../middleware/error.js';

export const FOLDERS = ['imgs', 'docs'] as const;
export type Folder = (typeof FOLDERS)[number];

/** Extensión → tipo MIME que aceptamos en subidas. */
export const EXT_MIME = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
]);

export function mimeForExt(ext: string): string | null {
  return EXT_MIME.get(ext.toLowerCase()) ?? null;
}

export function folderFromQuery(query: unknown): Folder {
  const raw = (query as { folder?: unknown } | undefined)?.folder;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const folder = typeof value === 'string' && value.length > 0 ? value : 'imgs';
  if (!(FOLDERS as readonly string[]).includes(folder)) {
    throw new AppError(
      400,
      'FOLDER_INVALIDO',
      `Carpeta inválida: "${folder}". Permitidas: ${FOLDERS.join(', ')}`,
    );
  }
  return folder as Folder;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
