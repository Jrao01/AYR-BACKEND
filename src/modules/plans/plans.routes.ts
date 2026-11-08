import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/error.js';
import {
  createPlanSchema,
  idOrSlugSchema,
  updatePlanSchema,
  type CreatePlanInput,
  type UpdatePlanInput,
} from './plans.schemas.js';

const GROUP_TO_DB = { hogar: 'HOGAR', avanzado: 'AVANZADO', empresarial: 'EMPRESARIAL' } as const;
const GROUP_TO_FE = { HOGAR: 'hogar', AVANZADO: 'avanzado', EMPRESARIAL: 'empresarial' } as const;

type PlanGroupDb = keyof typeof GROUP_TO_FE;
type PlanGroupFe = (typeof GROUP_TO_FE)[PlanGroupDb];

type PlanRow = {
  id: string;
  slug: string;
  name: string;
  speed: number;
  price: { toString(): string };
  segment: string;
  use: string;
  devices: string;
  group: string;
  order: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** DTO público: `id` = slug, para que el frontend lo use sin cambios (data/plans.ts). */
type PublicPlanDto = {
  id: string;
  slug: string;
  name: string;
  speed: number;
  price: number;
  segment: string;
  use: string;
  devices: string;
  group: PlanGroupFe;
  order: number;
};

type AdminPlanDto = PublicPlanDto & {
  dbId: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function groupToFe(group: string): PlanGroupFe {
  return GROUP_TO_FE[group as PlanGroupDb] ?? 'hogar';
}

function toPublicDto(row: PlanRow): PublicPlanDto {
  return {
    id: row.slug,
    slug: row.slug,
    name: row.name,
    speed: row.speed,
    price: Number(row.price),
    segment: row.segment,
    use: row.use,
    devices: row.devices,
    group: groupToFe(row.group),
    order: row.order,
  };
}

function toAdminDto(row: PlanRow): AdminPlanDto {
  return { ...toPublicDto(row), dbId: row.id, active: row.active, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function dataFromCreate(body: CreatePlanInput) {
  return {
    slug: body.slug,
    name: body.name,
    speed: body.speed,
    price: body.price,
    segment: body.segment,
    use: body.use,
    devices: body.devices,
    group: GROUP_TO_DB[body.group],
    ...(body.order !== undefined ? { order: body.order } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
  };
}

function dataFromUpdate(body: UpdatePlanInput) {
  return {
    ...(body.slug !== undefined ? { slug: body.slug } : {}),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.speed !== undefined ? { speed: body.speed } : {}),
    ...(body.price !== undefined ? { price: body.price } : {}),
    ...(body.segment !== undefined ? { segment: body.segment } : {}),
    ...(body.use !== undefined ? { use: body.use } : {}),
    ...(body.devices !== undefined ? { devices: body.devices } : {}),
    ...(body.group !== undefined ? { group: GROUP_TO_DB[body.group] } : {}),
    ...(body.order !== undefined ? { order: body.order } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
  };
}

async function findPlan(idOrSlug: string): Promise<PlanRow | null> {
  return prisma.plan.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
}

function parseId(req: { params: Record<string, string | undefined> }): string {
  return z.object({ id: idOrSlugSchema }).parse(req.params).id;
}

/** Rutas públicas: /api/plans */
export const plansPublicRouter = Router();

/** GET /api/plans — solo activos, en orden. */
plansPublicRouter.get('/', async (_req, res) => {
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { order: 'asc' } });
  res.json({ data: plans.map(toPublicDto) });
});

/** Rutas de administración: /api/admin/plans (requieren token). */
export const plansAdminRouter = Router();

/** GET /api/admin/plans — todos, incluidos inactivos. */
plansAdminRouter.get('/', async (_req, res) => {
  const plans = await prisma.plan.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
  res.json({ data: plans.map(toAdminDto) });
});

/** POST /api/admin/plans */
plansAdminRouter.post('/', async (req, res) => {
  const body = createPlanSchema.parse(req.body);
  const created = await prisma.plan.create({ data: dataFromCreate(body) });
  res.status(201).json({ data: toAdminDto(created) });
});

/** PATCH /api/admin/plans/:idOrSlug */
plansAdminRouter.patch('/:id', async (req, res) => {
  const id = parseId(req);
  const body = updatePlanSchema.parse(req.body);
  const existing = await findPlan(id);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Plan no encontrado');
  }
  const updated = await prisma.plan.update({ where: { id: existing.id }, data: dataFromUpdate(body) });
  res.json({ data: toAdminDto(updated) });
});

/** DELETE /api/admin/plans/:idOrSlug — soft delete (active=false). */
plansAdminRouter.delete('/:id', async (req, res) => {
  const id = parseId(req);
  const existing = await findPlan(id);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Plan no encontrado');
  }
  await prisma.plan.update({ where: { id: existing.id }, data: { active: false } });
  res.status(204).end();
});
