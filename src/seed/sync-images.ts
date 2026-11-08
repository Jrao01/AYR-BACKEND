import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { FOLDERS, mimeForExt, slugify } from '../modules/images/images.constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);

/**
 * Directorios candidatos con las imágenes base.
 *
 * - `PUBLIC_ASSETS_DIR`: ruta explícita por entorno.
 * - `../web/public`: monorepo en desarrollo (backend junto a web/).
 * - `seed-assets`: copia incluida en el repo del backend (imagen Docker), ya
 *   que web/public queda fuera del build context en despliegues separados.
 */
export function resolvePublicAssetsDir(): string | null {
  const candidates = [
    env.PUBLIC_ASSETS_DIR,
    path.resolve(ROOT, '..', 'web', 'public'),
    path.resolve(ROOT, 'seed-assets'),
    path.resolve(process.cwd(), 'seed-assets'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const dir = path.resolve(candidate);
    if (FOLDERS.some((folder) => fs.existsSync(path.join(dir, folder)))) {
      return dir;
    }
  }
  return null;
}

export type SyncResult = { created: number; updated: number; copied: number; source: string | null };

/**
 * Copia las imágenes base ({imgs,docs}) → UPLOAD_DIR y crea/actualiza los
 * ImageAsset. Identidad estable: (folder, originalName). Idempotente.
 *
 * Se ejecuta en cada arranque: repara volúmenes vacíos y completa las imágenes
 * que falten sin tocar las fotos subidas desde el panel.
 */
export async function syncImages(): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, copied: 0, source: null };

  const publicDir = resolvePublicAssetsDir();
  if (!publicDir) {
    console.warn(
      '[images] No se encontró un directorio de imágenes base (PUBLIC_ASSETS_DIR, ../web/public ni seed-assets); se omite la sincronización.',
    );
    return result;
  }
  result.source = publicDir;

  for (const folder of FOLDERS) {
    const dir = path.join(publicDir, folder);
    if (!fs.existsSync(dir)) continue;

    const files = fs
      .readdirSync(dir)
      .filter((file) => IMAGE_EXT.has(path.extname(file).toLowerCase()))
      .sort();

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const mimeType = mimeForExt(ext);
      if (!mimeType) continue;

      const src = path.join(dir, file);
      const destDir = path.join(env.UPLOAD_DIR, folder);
      const dest = path.join(destDir, file);
      fs.mkdirSync(destDir, { recursive: true });

      const stat = fs.statSync(src);
      const needsCopy = !fs.existsSync(dest) || fs.statSync(dest).size !== stat.size;
      if (needsCopy) {
        fs.copyFileSync(src, dest);
        result.copied += 1;
      }

      const existing = await prisma.imageAsset.findFirst({ where: { folder, originalName: file } });
      if (existing) {
        if (existing.fileName !== file || existing.size !== stat.size || existing.mimeType !== mimeType) {
          await prisma.imageAsset.update({
            where: { id: existing.id },
            data: { fileName: file, size: stat.size, mimeType },
          });
          result.updated += 1;
        }
        continue;
      }

      // Clave única global: si ya existe (p. ej. conatel-Logo.png en imgs y docs),
      // se prefija con la carpeta de forma determinista.
      let key = slugify(path.parse(file).name);
      const taken = await prisma.imageAsset.findUnique({ where: { key } });
      if (taken) key = `${folder}-${key}`;

      await prisma.imageAsset.create({
        data: { key, originalName: file, fileName: file, mimeType, size: stat.size, folder },
      });
      result.created += 1;
    }
  }

  return result;
}
