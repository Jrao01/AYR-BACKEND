import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error.js';
import {
  SECTION_IMAGES,
  SECTION_KEYS,
  folderFromQuery,
  isSectionKey,
  sectionFromParam,
  slugify,
  type Folder,
} from './images.constants.js';
import { upload } from './upload.js';
import { assertImageContent } from './validate-file.js';

const paramsSchema = z.object({ id: z.string().min(1, 'Id obligatorio') });

const keySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usa kebab-case: minúsculas, números y guiones');

const uploadBodySchema = z.object({
  key: keySchema.optional(),
  alt: z.string().max(300).optional(),
});

const patchBodySchema = z
  .object({
    key: keySchema.optional(),
    alt: z.string().max(300).nullable().optional(),
  })
  .refine((value) => value.key !== undefined || value.alt !== undefined, {
    message: 'Indica al menos key o alt',
  });

const sectionBodySchema = z.object({
  alt: z.string().max(300).optional(),
});

type ImageAssetRow = {
  id: string;
  key: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  alt: string | null;
  folder: string;
  createdAt: Date;
  updatedAt: Date;
};

type ImageDto = {
  id: string;
  key: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  alt: string | null;
  folder: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(asset: ImageAssetRow): ImageDto {
  return {
    id: asset.id,
    key: asset.key,
    originalName: asset.originalName,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    size: asset.size,
    alt: asset.alt,
    folder: asset.folder,
    url: `/uploads/${asset.folder}/${asset.fileName}`,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

async function discardFile(file: Express.Multer.File): Promise<void> {
  await fs.promises.unlink(file.path).catch(() => undefined);
}

/** Valida el contenido del archivo recién subido y limpia si no es válido. */
async function validatedMime(file: Express.Multer.File): Promise<string> {
  try {
    return await assertImageContent(file.path, file.originalname);
  } catch (err) {
    await discardFile(file);
    throw err;
  }
}

async function removeAssetFile(asset: ImageAssetRow): Promise<void> {
  await fs.promises
    .unlink(path.join(env.UPLOAD_DIR, asset.folder, asset.fileName))
    .catch(() => undefined);
}

/**
 * Guarda un archivo con una clave fija (secciones o foto de sede). Si la clave
 * ya existe, reemplaza el archivo y borra el anterior.
 */
async function upsertFixedImage(
  key: string,
  file: Express.Multer.File,
  alt: string | undefined,
  folder: Folder = 'imgs',
): Promise<ImageAssetRow> {
  const mimeType = await validatedMime(file);
  const existing = await prisma.imageAsset.findUnique({ where: { key } });

  try {
    const asset = existing
      ? await prisma.imageAsset.update({
          where: { id: existing.id },
          data: {
            originalName: file.originalname,
            fileName: file.filename,
            mimeType,
            size: file.size,
            alt: alt ?? existing.alt,
            folder,
          },
        })
      : await prisma.imageAsset.create({
          data: {
            key,
            originalName: file.originalname,
            fileName: file.filename,
            mimeType,
            size: file.size,
            alt: alt ?? null,
            folder,
          },
        });

    // El archivo anterior solo se borra cuando la BD ya apunta al nuevo.
    if (existing) await removeAssetFile(existing);
    return asset;
  } catch (err) {
    await discardFile(file);
    throw err;
  }
}

/* ── Lectura pública: imágenes fijas de las secciones ─────────────────── */

/**
 * GET /api/images/sections
 * Devuelve el catálogo fijo con la URL de la imagen subida (o `null` para que
 * el frontend use su respaldo local). Sin token: lo consume el sitio público.
 */
export const imagesPublicRouter = Router();

imagesPublicRouter.get('/sections', async (_req, res) => {
  const assets = await prisma.imageAsset.findMany({
    where: { key: { in: [...SECTION_KEYS] } },
  });
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));

  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({
    data: SECTION_IMAGES.map((section) => {
      const asset = byKey.get(section.key);
      return {
        key: section.key,
        label: section.label,
        description: section.description,
        fallback: section.fallback,
        defaultAlt: section.defaultAlt,
        url: asset ? toDto(asset).url : null,
        alt: asset?.alt ?? null,
        updatedAt: asset?.updatedAt ?? null,
      };
    }),
  });
});

/* ── Administración: biblioteca de imágenes ───────────────────────────── */

export const imagesRouter = Router();

/** GET /api/admin/images */
imagesRouter.get('/', async (_req, res) => {
  const assets = await prisma.imageAsset.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ data: assets.map(toDto) });
});

/** POST /api/admin/images/upload?folder=imgs  (multipart: file, key?, alt?) */
imagesRouter.post('/upload', upload.single('file'), async (req, res) => {
  const folder: Folder = folderFromQuery(req.query);
  const file = req.file;

  if (!file) {
    throw new AppError(400, 'ARCHIVO_REQUERIDO', 'Falta el archivo en el campo "file"');
  }

  const mimeType = await validatedMime(file);
  const body = uploadBodySchema.parse(req.body);
  const key = body.key ?? slugify(path.parse(file.originalname).name);
  if (!key) {
    await discardFile(file);
    throw new AppError(400, 'KEY_INVALIDA', 'No se pudo derivar una clave válida del nombre');
  }

  // Las claves de sección están reservadas: se gestionan desde su tarjeta.
  if (isSectionKey(key)) {
    await discardFile(file);
    throw new AppError(
      409,
      'KEY_RESERVADA',
      `La clave "${key}" pertenece a una sección fija. Reemplaza la imagen desde la tarjeta de la sección.`,
    );
  }

  const taken = await prisma.imageAsset.findUnique({ where: { key }, select: { id: true } });
  if (taken) {
    await discardFile(file);
    throw new AppError(
      409,
      'KEY_DUPLICADA',
      `Ya existe una imagen con la clave "${key}". Envía otra clave en el campo "key".`,
    );
  }

  try {
    const asset = await prisma.imageAsset.create({
      data: {
        key,
        originalName: file.originalname,
        fileName: file.filename,
        mimeType,
        size: file.size,
        alt: body.alt ?? null,
        folder,
      },
    });
    res.status(201).json({ data: toDto(asset) });
  } catch (err) {
    await discardFile(file);
    throw err;
  }
});

/* ── Administración: secciones fijas ──────────────────────────────────── */

/** PUT /api/admin/images/sections/:key — sube o reemplaza la imagen de una sección. */
imagesRouter.put('/sections/:key', upload.single('file'), async (req, res) => {
  const section = sectionFromParam(req.params.key);
  const file = req.file;
  if (!file) {
    throw new AppError(400, 'ARCHIVO_REQUERIDO', 'Falta el archivo en el campo "file"');
  }

  const body = sectionBodySchema.parse(req.body ?? {});
  const asset = await upsertFixedImage(section.key, file, body.alt, 'imgs');
  res.status(201).json({ data: toDto(asset) });
});

/** DELETE /api/admin/images/sections/:key — vuelve a la imagen local de respaldo. */
imagesRouter.delete('/sections/:key', async (req, res) => {
  const section = sectionFromParam(req.params.key);
  const asset = await prisma.imageAsset.findUnique({ where: { key: section.key } });
  if (asset) {
    await removeAssetFile(asset);
    await prisma.imageAsset.delete({ where: { id: asset.id } });
  }
  res.status(204).end();
});

/* ── Administración: fotos de sedes / oficinas ────────────────────────── */

async function findLocation(idOrSlug: string) {
  return prisma.mapLocation.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
  });
}

/**
 * PUT /api/admin/images/locations/:idOrSlug — sube o reemplaza la foto de una
 * sede y la asigna a la ubicación. La clave interna es `sede-<slug>`.
 */
imagesRouter.put('/locations/:idOrSlug', upload.single('file'), async (req, res) => {
  const idOrSlug = String(req.params.idOrSlug);
  const location = await findLocation(idOrSlug);
  if (!location) {
    throw new AppError(404, 'NOT_FOUND', 'Ubicación no encontrada');
  }
  const file = req.file;
  if (!file) {
    throw new AppError(400, 'ARCHIVO_REQUERIDO', 'Falta el archivo en el campo "file"');
  }

  const key = `sede-${location.slug}`;
  const asset = await upsertFixedImage(key, file, undefined, 'imgs');
  await prisma.mapLocation.update({
    where: { id: location.id },
    data: { imageId: asset.id, imageOptOut: false },
  });

  res.status(201).json({
    data: { locationId: location.id, key, imageId: asset.id, url: toDto(asset).url },
  });
});

/** DELETE /api/admin/images/locations/:idOrSlug/image — deja la sede sin foto. */
imagesRouter.delete('/locations/:idOrSlug/image', async (req, res) => {
  const idOrSlug = String(req.params.idOrSlug);
  const location = await findLocation(idOrSlug);
  if (!location) {
    throw new AppError(404, 'NOT_FOUND', 'Ubicación no encontrada');
  }

  await prisma.mapLocation.update({
    where: { id: location.id },
    // La marca evita que el seed vuelva a asignar la imagen base al reiniciar.
    data: { imageId: null, imageOptOut: true },
  });

  const key = `sede-${location.slug}`;
  const asset = await prisma.imageAsset.findUnique({ where: { key } });
  if (asset) {
    await removeAssetFile(asset);
    await prisma.imageAsset.delete({ where: { id: asset.id } });
  }

  res.status(204).end();
});

/* ── Administración: edición / borrado de la biblioteca ───────────────── */

/** PATCH /api/admin/images/:id */
imagesRouter.patch('/:id', async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const body = patchBodySchema.parse(req.body);

  const existing = await prisma.imageAsset.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Imagen no encontrada');
  }

  // La clave de una sección fija es estable: no se puede renombrar.
  if (body.key !== undefined) {
    if (isSectionKey(existing.key)) {
      throw new AppError(
        409,
        'KEY_BLOQUEADA',
        `La clave "${existing.key}" pertenece a una sección fija y no se puede cambiar.`,
      );
    }
    if (isSectionKey(body.key)) {
      throw new AppError(
        409,
        'KEY_RESERVADA',
        `La clave "${body.key}" pertenece a una sección fija.`,
      );
    }
  }

  const asset = await prisma.imageAsset.update({
    where: { id },
    data: {
      ...(body.key !== undefined ? { key: body.key } : {}),
      ...(body.alt !== undefined ? { alt: body.alt } : {}),
    },
  });
  res.json({ data: toDto(asset) });
});

/** DELETE /api/admin/images/:id — borra disco + registro (409 si está en uso). */
imagesRouter.delete('/:id', async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const asset = await prisma.imageAsset.findUnique({ where: { id } });
  if (!asset) {
    throw new AppError(404, 'NOT_FOUND', 'Imagen no encontrada');
  }

  if (isSectionKey(asset.key)) {
    throw new AppError(
      409,
      'SECCION_PROTEGIDA',
      'Esta imagen pertenece a una sección fija. Usa «Restablecer» en su tarjeta.',
    );
  }

  const inUse = await prisma.mapLocation.count({ where: { imageId: id } });
  if (inUse > 0) {
    throw new AppError(
      409,
      'IMAGEN_EN_USO',
      `La imagen está referenciada por ${inUse} ubicación(es) del mapa`,
    );
  }

  await removeAssetFile(asset);
  await prisma.imageAsset.delete({ where: { id } });
  res.status(204).end();
});
