import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error.js';
import {
  createLocationSchema,
  listLocationsQuerySchema,
  updateLocationSchema,
  type CreateLocationInput,
  type LocationTypeFe,
  type UpdateLocationInput,
} from './locations.schemas.js';
import { idOrSlugSchema } from '../plans/plans.schemas.js';

const TYPE_TO_DB = { office: 'OFFICE', future: 'FUTURE' } as const;
const TYPE_TO_FE = { OFFICE: 'office', FUTURE: 'future' } as const;

type LocationTypeDb = keyof typeof TYPE_TO_FE;

type LocationRow = {
  id: string;
  slug: string;
  type: string;
  municipality: string;
  state: string;
  address: string | null;
  reference: string | null;
  phone: string | null;
  lat: { toString(): string };
  lng: { toString(): string };
  imageId: string | null;
  image: { folder: string; fileName: string } | null;
  order: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** DTO público: coords como [lat, lng] e image como URL, igual que data/offices.ts. */
type PublicLocationDto = {
  id: string;
  slug: string;
  type: LocationTypeFe;
  municipality: string;
  state: string;
  address: string | null;
  reference: string | null;
  phone: string | null;
  coords: [number, number];
  image: string | null;
  order: number;
};

type AdminLocationDto = PublicLocationDto & {
  dbId: string;
  lat: number;
  lng: number;
  imageId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const publicSelect = {
  id: true,
  slug: true,
  type: true,
  municipality: true,
  state: true,
  address: true,
  reference: true,
  phone: true,
  lat: true,
  lng: true,
  imageId: true,
  order: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  image: { select: { folder: true, fileName: true } },
};

function toTypeFe(type: string): LocationTypeFe {
  return TYPE_TO_FE[type as LocationTypeDb] ?? 'future';
}

function toPublicDto(row: LocationRow): PublicLocationDto {
  return {
    id: row.slug,
    slug: row.slug,
    type: toTypeFe(row.type),
    municipality: row.municipality,
    state: row.state,
    address: row.address,
    reference: row.reference,
    phone: row.phone,
    coords: [Number(row.lat), Number(row.lng)],
    image: row.image ? `/uploads/${row.image.folder}/${row.image.fileName}` : null,
    order: row.order,
  };
}

function toAdminDto(row: LocationRow): AdminLocationDto {
  return {
    ...toPublicDto(row),
    dbId: row.id,
    lat: Number(row.lat),
    lng: Number(row.lng),
    imageId: row.imageId,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function dataFromCreate(body: CreateLocationInput) {
  return {
    slug: body.slug,
    type: TYPE_TO_DB[body.type],
    municipality: body.municipality,
    state: body.state,
    lat: body.lat,
    lng: body.lng,
    ...(body.address !== undefined ? { address: body.address } : {}),
    ...(body.reference !== undefined ? { reference: body.reference } : {}),
    ...(body.phone !== undefined ? { phone: body.phone } : {}),
    ...(body.imageId !== undefined ? { imageId: body.imageId } : {}),
    ...(body.order !== undefined ? { order: body.order } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
  };
}

function dataFromUpdate(body: UpdateLocationInput) {
  return {
    ...(body.slug !== undefined ? { slug: body.slug } : {}),
    ...(body.type !== undefined ? { type: TYPE_TO_DB[body.type] } : {}),
    ...(body.municipality !== undefined ? { municipality: body.municipality } : {}),
    ...(body.state !== undefined ? { state: body.state } : {}),
    ...(body.address !== undefined ? { address: body.address } : {}),
    ...(body.reference !== undefined ? { reference: body.reference } : {}),
    ...(body.phone !== undefined ? { phone: body.phone } : {}),
    ...(body.lat !== undefined ? { lat: body.lat } : {}),
    ...(body.lng !== undefined ? { lng: body.lng } : {}),
    ...(body.imageId !== undefined ? { imageId: body.imageId } : {}),
    ...(body.order !== undefined ? { order: body.order } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
  };
}

async function findLocation(idOrSlug: string): Promise<(LocationRow & { dbId?: string }) | null> {
  return prisma.mapLocation.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: publicSelect,
  });
}

function parseId(req: { params: Record<string, string | undefined> }): string {
  return z.object({ id: idOrSlugSchema }).parse(req.params).id;
}

/** Rutas públicas: /api/locations */
export const locationsPublicRouter = Router();

/** GET /api/locations?type=office|future — activas, en orden. Sin `type` devuelve ambas. */
locationsPublicRouter.get('/', async (req, res) => {
  const query = listLocationsQuerySchema.parse(req.query);
  const locations = await prisma.mapLocation.findMany({
    where: { active: true, ...(query.type ? { type: TYPE_TO_DB[query.type] } : {}) },
    orderBy: { order: 'asc' },
    select: publicSelect,
  });
  res.json({ data: locations.map(toPublicDto) });
});

/** Rutas de administración: /api/admin/locations (requieren token). */
export const locationsAdminRouter = Router();

/** GET /api/admin/locations */
locationsAdminRouter.get('/', async (_req, res) => {
  const locations = await prisma.mapLocation.findMany({
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: publicSelect,
  });
  res.json({ data: locations.map(toAdminDto) });
});

/** POST /api/admin/locations */
locationsAdminRouter.post('/', async (req, res) => {
  const body = createLocationSchema.parse(req.body);
  const created = await prisma.mapLocation.create({
    data: dataFromCreate(body),
    select: publicSelect,
  });
  res.status(201).json({ data: toAdminDto(created) });
});

/** PATCH /api/admin/locations/:idOrSlug */
locationsAdminRouter.patch('/:id', async (req, res) => {
  const id = parseId(req);
  const body = updateLocationSchema.parse(req.body);
  const existing = await findLocation(id);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Ubicación no encontrada');
  }
  // Invariante de oficinas también al editar (p. ej. cambiar type future→office):
  // la fila final debe conservar dirección y teléfono.
  const finalType = body.type ?? TYPE_TO_FE[existing.type as LocationTypeDb];
  if (finalType === 'office') {
    const address = body.address ?? existing.address;
    const phone = body.phone ?? existing.phone;
    if (!address || !phone) {
      throw new AppError(400, 'OFICINA_INCOMPLETA', 'Las oficinas requieren dirección y teléfono');
    }
  }
  const updated = await prisma.mapLocation.update({
    where: { id: existing.id },
    data: dataFromUpdate(body),
    select: publicSelect,
  });
  res.json({ data: toAdminDto(updated) });
});

/** DELETE /api/admin/locations/:idOrSlug — soft delete (active=false). */
locationsAdminRouter.delete('/:id', async (req, res) => {
  const id = parseId(req);
  const existing = await findLocation(id);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Ubicación no encontrada');
  }
  await prisma.mapLocation.delete({ where: { id: existing.id } });
  res.status(204).end();
});
