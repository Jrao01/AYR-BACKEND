import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma.ts';
import { seed } from '../src/seed/seed.ts';

export { seed } from '../src/seed/seed.ts';

const isDirectRun =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  try {
    await seed();
  } finally {
    await prisma.$disconnect();
  }
}
