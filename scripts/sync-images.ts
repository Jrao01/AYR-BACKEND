import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/config/env.ts';
import { prisma } from '../src/lib/prisma.ts';
import { FOLDERS, mimeForExt, slugify } from '../src/modules/images/images.constants.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Repo AyrInfoPage: este backend vive en AYR-BACKEND/ junto a web/. */
const PUBLIC_DIR = path.resolve(ROOT, '..', 'web', 'public');
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);

export type SyncResult = { created: number; updated: number; copied: number };

/**
 * Copia web/public/{imgs,docs} → UPLOAD_DIR y crea/actualiza los ImageAsset.
 * Identidad estable: (folder, originalName). Idempotente.
 */
export async function syncImages(): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, copied: 0 };

  if (!fs.existsSync(PUBLIC_DIR)) {
    console.warn(`[images] No existe ${PUBLIC_DIR}; se omite la sincronización.`);
    return result;
  }

  for (const folder of FOLDERS) {
    const dir = path.join(PUBLIC_DIR, folder);
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

const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  const result = await syncImages();
  console.log(
    `[images] creadas=${result.created} actualizadas=${result.updated} copiadas=${result.copied} → ${path.resolve(env.UPLOAD_DIR)}`,
  );
  await prisma.$disconnect();
}
