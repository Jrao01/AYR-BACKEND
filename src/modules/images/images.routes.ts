import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error.js';
import { folderFromQuery, slugify, type Folder } from './images.constants.js';
import { upload } from './upload.js';
import { assertImageContent } from './validate-file.js';

export const imagesRouter = Router();

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

  let mimeType: string;
  try {
    mimeType = await assertImageContent(file.path, file.originalname);
  } catch (err) {
    await fs.promises.unlink(file.path).catch(() => undefined);
    throw err;
  }

  const body = uploadBodySchema.parse(req.body);
  const key = body.key ?? slugify(path.parse(file.originalname).name);
  if (!key) {
    await fs.promises.unlink(file.path).catch(() => undefined);
    throw new AppError(400, 'KEY_INVALIDA', 'No se pudo derivar una clave válida del nombre');
  }

  const taken = await prisma.imageAsset.findUnique({ where: { key }, select: { id: true } });
  if (taken) {
    await fs.promises.unlink(file.path).catch(() => undefined);
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
    await fs.promises.unlink(file.path).catch(() => undefined);
    throw err;
  }
});

/** PATCH /api/admin/images/:id */
imagesRouter.patch('/:id', async (req, res) => {
  const { id } = paramsSchema.parse(req.params);
  const body = patchBodySchema.parse(req.body);
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

  const inUse = await prisma.mapLocation.count({ where: { imageId: id } });
  if (inUse > 0) {
    throw new AppError(
      409,
      'IMAGEN_EN_USO',
      `La imagen está referenciada por ${inUse} ubicación(es) del mapa`,
    );
  }

  await fs.promises
    .unlink(path.join(env.UPLOAD_DIR, asset.folder, asset.fileName))
    .catch(() => undefined);
  await prisma.imageAsset.delete({ where: { id } });
  res.status(204).end();
});
