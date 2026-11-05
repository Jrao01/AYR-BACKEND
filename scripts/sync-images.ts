import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/config/env.ts';
import { prisma } from '../src/lib/prisma.ts';
import { syncImages } from '../src/seed/sync-images.ts';

export { syncImages, type SyncResult } from '../src/seed/sync-images.ts';

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
