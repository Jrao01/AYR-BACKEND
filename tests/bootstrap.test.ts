import { describe, expect, it } from 'vitest';
import { ensureAdmin, isSeedNeeded } from '../src/bootstrap.ts';
import { prisma } from '../src/lib/prisma.ts';

describe('bootstrap', () => {
  it('no crea otro admin cuando ya existen usuarios', async () => {
    const before = await prisma.user.count();
    expect(before).toBeGreaterThan(0);

    expect(await ensureAdmin()).toBe(false);
    expect(await prisma.user.count()).toBe(before);
  });

  it('no considera necesario el seed si las tablas base tienen datos', async () => {
    expect(await isSeedNeeded()).toBe(false);
  });
});
