import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../utils/password.js';
import { syncImages } from './sync-images.js';
import { plans, offices, privacy, terms, type LegalSection as LegalSectionFE } from './seed-content.js';

/** Fecha "última modificación" que hoy está hardcodeada en web/src/pages/Legal.tsx. */
const LEGAL_SINCE = new Date('2026-10-15T00:00:00.000Z');

/** Marcador futuro de MapboxMap.tsx (EXTRA_MARKERS). */
const NIRGUA = { slug: 'nirgua', municipality: 'Nirgua', state: 'Yaracuy', lat: 10.153012, lng: -68.571615 };

const PLAN_GROUPS = { hogar: 'HOGAR', avanzado: 'AVANZADO', empresarial: 'EMPRESARIAL' } as const;

function sectionsCreateInput(sections: LegalSectionFE[]) {
  return sections.map((section, index) => ({
    sectionId: section.id,
    title: section.title,
    order: index,
    paragraphs: section.paragraphs ?? [],
    list: section.list ?? [],
    note: section.note ?? null,
  }));
}

async function seedPlans() {
  for (const [index, plan] of plans.entries()) {
    const group = PLAN_GROUPS[plan.group ?? 'hogar'];
    await prisma.plan.upsert({
      where: { slug: plan.id },
      create: {
        slug: plan.id,
        name: plan.name,
        speed: plan.speed,
        price: plan.price,
        segment: plan.segment,
        use: plan.use,
        devices: plan.devices,
        group,
        order: index,
      },
      update: {
        name: plan.name,
        speed: plan.speed,
        price: plan.price,
        segment: plan.segment,
        use: plan.use,
        devices: plan.devices,
        group,
        order: index,
        active: true,
      },
    });
  }
  return plans.length;
}

/**
 * Extensiones aceptadas para la foto base de una sede. El seed histórico usaba
 * `.jpg`, pero así también funciona si la imagen se reemplaza por otro formato.
 */
const LOCATION_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

function locationImageNames(slug: string): string[] {
  return LOCATION_IMAGE_EXTENSIONS.map((ext) => `${slug}${ext}`);
}

/**
 * Vincula las sedes sin foto con una imagen ya registrada:
 *  1. `sede-<slug>` → foto subida explícitamente desde el formulario de la sede.
 *  2. `<slug>.<ext>` → imagen base del seed.
 *
 * Solo rellena `imageId` cuando es null: nunca pisa una foto elegida desde el
 * panel. Idempotente; se ejecuta en cada arranque.
 */
export async function syncLocationImages(): Promise<number> {
  let linked = 0;

  for (const office of offices) {
    const location = await prisma.mapLocation.findUnique({
      where: { slug: office.id },
      select: { id: true, imageId: true, imageOptOut: true },
    });
    if (!location || location.imageId || location.imageOptOut) continue;

    const explicit = await prisma.imageAsset.findUnique({
      where: { key: `sede-${office.id}` },
      select: { id: true },
    });
    const image =
      explicit ??
      (await prisma.imageAsset.findFirst({
        where: { folder: 'imgs', originalName: { in: locationImageNames(office.id) } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }));
    if (!image) continue;

    await prisma.mapLocation.update({ where: { id: location.id }, data: { imageId: image.id } });
    linked += 1;
  }

  return linked;
}

async function seedLocations() {
  const rows = [
    ...offices.map((office, index) => ({
      slug: office.id,
      type: 'OFFICE' as const,
      municipality: office.municipality,
      state: office.state,
      address: office.address,
      reference: office.reference,
      phone: office.phone,
      lat: office.coords[0],
      lng: office.coords[1],
      order: index,
      imageFile: `${office.id}.jpg`,
    })),
    {
      slug: NIRGUA.slug,
      type: 'FUTURE' as const,
      municipality: NIRGUA.municipality,
      state: NIRGUA.state,
      address: null as string | null,
      reference: null as string | null,
      phone: null as string | null,
      lat: NIRGUA.lat,
      lng: NIRGUA.lng,
      order: 10,
      imageFile: null as string | null,
    },
  ];

  for (const row of rows) {
    const image = row.imageFile
      ? await prisma.imageAsset.findFirst({
          where: { folder: 'imgs', originalName: row.imageFile },
          select: { id: true },
        })
      : null;

    const existing = await prisma.mapLocation.findUnique({
      where: { slug: row.slug },
      select: { imageId: true, imageOptOut: true },
    });

    const data = {
      type: row.type,
      municipality: row.municipality,
      state: row.state,
      address: row.address,
      reference: row.reference,
      phone: row.phone,
      lat: row.lat,
      lng: row.lng,
      order: row.order,
      // Una foto ya asignada desde el panel manda sobre la imagen base; si el
      // panel la quitó expresamente, el seed respeta esa decisión.
      imageId: existing?.imageOptOut ? null : (existing?.imageId ?? image?.id ?? null),
      active: true,
    };

    await prisma.mapLocation.upsert({
      where: { slug: row.slug },
      create: { slug: row.slug, ...data },
      update: data,
    });
  }
  return rows.length;
}

async function seedLegal() {
  const docs = [
    { type: 'TERMS' as const, slug: 'terminos', title: 'Términos y Condiciones', sections: terms },
    { type: 'PRIVACY' as const, slug: 'privacidad', title: 'Aviso de Privacidad', sections: privacy },
  ];

  for (const doc of docs) {
    await prisma.legalDocument.upsert({
      where: { type: doc.type },
      create: {
        type: doc.type,
        slug: doc.slug,
        title: doc.title,
        status: 'PUBLISHED',
        version: 1,
        lastModifiedAt: LEGAL_SINCE,
        publishedAt: LEGAL_SINCE,
        // La fecha del contenido sembrado = el sello de publicación (no queda "sucio").
        updatedAt: LEGAL_SINCE,
        sections: { create: sectionsCreateInput(doc.sections) },
      },
      update: {
        slug: doc.slug,
        title: doc.title,
        updatedAt: LEGAL_SINCE,
        // No toca version/lastModifiedAt: esas fechas las gestiona el publish de la API.
        sections: { deleteMany: {}, create: sectionsCreateInput(doc.sections) },
      },
    });
  }
  return docs.reduce((total, doc) => total + doc.sections.length, 0);
}

/**
 * Crea el usuario administrador definido en .env solo si no existe ningún
 * usuario. Devuelve true si lo creó.
 */
export async function seedAdmin(): Promise<boolean> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.warn('[seed] ADMIN_EMAIL/ADMIN_PASSWORD no definidos: no se crea usuario admin.');
    return false;
  }
  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return false;

  await prisma.user.create({
    data: { email, passwordHash: await hashPassword(env.ADMIN_PASSWORD), name: 'Administrador', role: 'ADMIN' },
  });
  return true;
}

export async function seed() {
  const images = await syncImages();
  const planCount = await seedPlans();
  const locationCount = await seedLocations();
  const linkedImages = await syncLocationImages();
  const sectionCount = await seedLegal();
  const adminCount = await seedAdmin();

  const [plansDb, locationsDb, documentsDb, sectionsDb, usersDb, assetsDb] = await Promise.all([
    prisma.plan.count(),
    prisma.mapLocation.count(),
    prisma.legalDocument.count(),
    prisma.legalSection.count(),
    prisma.user.count(),
    prisma.imageAsset.count(),
  ]);

  console.log('[seed] listo');
  console.log(
    `  imágenes: ${assetsDb} en BD (${images.created} nuevas, ${images.copied} copiadas a uploads, ${linkedImages} sedes vinculadas)`,
  );
  console.log(`  planes: ${planCount} sembrados → ${plansDb} en BD`);
  console.log(`  ubicaciones: ${locationCount} sembradas → ${locationsDb} en BD`);
  console.log(`  secciones legales: ${sectionCount} sembradas → ${sectionsDb} en BD (${documentsDb} documentos)`);
  console.log(`  administradores nuevos: ${adminCount ? 1 : 0} → ${usersDb} en BD`);

  return { planCount, locationCount, sectionCount, adminCount: adminCount ? 1 : 0 };
}
