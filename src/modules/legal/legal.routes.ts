import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error.js';
import { requireUser } from '../../middleware/auth.js';
import {
  publishSchema,
  saveDraftSchema,
  slugParamSchema,
  type LegalSectionInput,
} from './legal.schemas.js';

const TYPE_TO_FE = { TERMS: 'terms', PRIVACY: 'privacy' } as const;
type LegalTypeFe = (typeof TYPE_TO_FE)[keyof typeof TYPE_TO_FE];

type SectionRow = {
  sectionId: string;
  title: string;
  order: number;
  paragraphs: string[];
  list: string[];
  note: string | null;
};

type DocRow = {
  id: string;
  slug: string;
  type: string;
  title: string;
  status: string;
  version: number;
  lastModifiedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sections: SectionRow[];
};

type PublicSectionDto = {
  id: string;
  title: string;
  paragraphs?: string[];
  list?: string[];
  note?: string;
};

type PublicDocDto = {
  slug: string;
  type: LegalTypeFe;
  title: string;
  version: number;
  lastModifiedAt: string | null;
  sections: PublicSectionDto[];
};

type AdminDocDto = PublicDocDto & {
  dbId: string;
  status: string;
  publishedAt: string | null;
  updatedAt: string;
  /** true cuando el borrador tiene cambios que aún no se han publicado (sellado). */
  hasUnpublishedChanges: boolean;
};

const docSelect = {
  id: true,
  slug: true,
  type: true,
  title: true,
  status: true,
  version: true,
  lastModifiedAt: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  sections: { orderBy: { order: 'asc' as const } },
};

const indexSelect = {
  id: true,
  slug: true,
  type: true,
  title: true,
  status: true,
  version: true,
  lastModifiedAt: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
};

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** Prisma guarda listas vacías; el frontend las espera ausentes cuando no hay contenido. */
function toSectionDto(section: SectionRow): PublicSectionDto {
  return {
    id: section.sectionId,
    title: section.title,
    ...(section.paragraphs.length > 0 ? { paragraphs: section.paragraphs } : {}),
    ...(section.list.length > 0 ? { list: section.list } : {}),
    ...(section.note ? { note: section.note } : {}),
  };
}

function toPublicDto(doc: DocRow): PublicDocDto {
  return {
    slug: doc.slug,
    type: TYPE_TO_FE[doc.type as keyof typeof TYPE_TO_FE] ?? 'terms',
    title: doc.title,
    version: doc.version,
    lastModifiedAt: iso(doc.lastModifiedAt),
    sections: doc.sections.map(toSectionDto),
  };
}

function toAdminDto(doc: DocRow): AdminDocDto {
  const lastModified = doc.lastModifiedAt ? doc.lastModifiedAt.getTime() : 0;
  return {
    ...toPublicDto(doc),
    dbId: doc.id,
    status: doc.status,
    publishedAt: iso(doc.publishedAt),
    updatedAt: doc.updatedAt.toISOString(),
    hasUnpublishedChanges: doc.updatedAt.getTime() > lastModified,
  };
}

function sectionsCreateInput(sections: LegalSectionInput[]) {
  return sections.map((section, index) => ({
    sectionId: section.id,
    title: section.title,
    order: index,
    paragraphs: section.paragraphs ?? [],
    list: section.list ?? [],
    note: section.note ?? null,
  }));
}

function parseSlug(req: { params: Record<string, string | undefined> }): string {
  return slugParamSchema.parse(req.params).slug;
}

async function findDoc(slug: string): Promise<DocRow | null> {
  return prisma.legalDocument.findUnique({ where: { slug }, select: docSelect });
}

async function requireDoc(slug: string): Promise<DocRow> {
  const doc = await findDoc(slug);
  if (!doc) {
    throw new AppError(404, 'NOT_FOUND', `Documento legal "${slug}" no encontrado`);
  }
  return doc;
}

function draftData(body: { title?: string; sections?: LegalSectionInput[] }) {
  return {
    // Prisma no actualiza la fila padre si el update solo trae escrituras anidadas
    // (secciones); `updatedAt` explícito marca el momento del borrador.
    updatedAt: new Date(),
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.sections !== undefined ? { sections: { deleteMany: {}, create: sectionsCreateInput(body.sections) } } : {}),
  };
}

/** Rutas públicas: /api/legal */
export const legalPublicRouter = Router();

type IndexRow = Omit<DocRow, 'sections'>;

/** GET /api/legal — índice de los documentos publicados. */
legalPublicRouter.get('/', async (_req, res) => {
  const docs = await prisma.legalDocument.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { type: 'asc' },
    select: indexSelect,
  });
  res.json({
    data: docs.map((doc: IndexRow) => {
      const { slug, type, title, version, lastModifiedAt } = doc;
      return {
        slug,
        type: TYPE_TO_FE[type as keyof typeof TYPE_TO_FE] ?? 'terms',
        title,
        version,
        lastModifiedAt: iso(lastModifiedAt),
      };
    }),
  });
});

/** GET /api/legal/:slug — documento publicado con sus secciones. */
legalPublicRouter.get('/:slug', async (req, res) => {
  const slug = parseSlug(req);
  const doc = await findDoc(slug);
  if (!doc || doc.status !== 'PUBLISHED') {
    throw new AppError(404, 'NOT_FOUND', `Documento legal "${slug}" no encontrado`);
  }
  res.json({ data: toPublicDto(doc) });
});

/** Rutas de administración: /api/admin/legal (requieren token). */
export const legalAdminRouter = Router();

/** GET /api/admin/legal/:slug — borrador completo con estado. */
legalAdminRouter.get('/:slug', async (req, res) => {
  const doc = await requireDoc(parseSlug(req));
  res.json({ data: toAdminDto(doc) });
});

/** PUT /api/admin/legal/:slug — guarda el borrador; NO toca lastModifiedAt. */
legalAdminRouter.put('/:slug', async (req, res) => {
  const slug = parseSlug(req);
  const body = saveDraftSchema.parse(req.body);
  const existing = await requireDoc(slug);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.legalDocument.update({
      where: { id: existing.id },
      data: draftData(body),
    });
    return tx.legalDocument.findUnique({ where: { id: existing.id }, select: docSelect });
  });

  res.json({ data: toAdminDto(updated as DocRow) });
});

/** POST /api/admin/legal/:slug/publish — publica: versión+1, fechas y revisión (transaccional). */
legalAdminRouter.post('/:slug/publish', async (req, res) => {
  const slug = parseSlug(req);
  const user = requireUser(req);
  const body = publishSchema.parse(req.body ?? {});
  const existing = await requireDoc(slug);

  const published = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const nextVersion = existing.version + 1;

    await tx.legalDocument.update({
      where: { id: existing.id },
      data: {
        ...draftData(body),
        status: 'PUBLISHED',
        version: nextVersion,
        lastModifiedAt: now,
        publishedAt: now,
        // Mismo instante que lastModifiedAt: al publicar no quedan "cambios sin sellar".
        updatedAt: now,
        updatedById: user.id,
      },
    });

    await tx.legalRevision.create({
      data: {
        documentId: existing.id,
        version: nextVersion,
        changedById: user.id,
        summary: body.summary ?? null,
      },
    });

    return tx.legalDocument.findUnique({ where: { id: existing.id }, select: docSelect });
  });

  res.json({ data: toAdminDto(published as DocRow) });
});

/** GET /api/admin/legal/:slug/history — revisiones, de la más reciente a la más antigua. */
legalAdminRouter.get('/:slug/history', async (req, res) => {
  const slug = parseSlug(req);
  const doc = await requireDoc(slug);

  const revisions = await prisma.legalRevision.findMany({
    where: { documentId: doc.id },
    orderBy: { version: 'desc' },
    select: {
      version: true,
      changedAt: true,
      summary: true,
      changedBy: { select: { email: true } },
    },
  });

  res.json({
    data: revisions.map((revision) => ({
      version: revision.version,
      changedAt: revision.changedAt.toISOString(),
      summary: revision.summary,
      changedBy: revision.changedBy?.email ?? null,
    })),
  });
});
