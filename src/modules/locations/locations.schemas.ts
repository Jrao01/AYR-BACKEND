import { z } from 'zod';
import { slugSchema } from '../plans/plans.schemas.js';

export const locationTypeValues = ['office', 'future'] as const;

const latSchema = z.number().min(-90, 'Latitud entre -90 y 90').max(90, 'Latitud entre -90 y 90');
const lngSchema = z.number().min(-180, 'Longitud entre -180 y 180').max(180, 'Longitud entre -180 y 180');

const locationFields = {
  slug: slugSchema,
  type: z.enum(locationTypeValues),
  municipality: z.string().min(1).max(120),
  state: z.string().min(1).max(120).default('Carabobo'),
  address: z.string().min(1).max(300).optional(),
  reference: z.string().min(1).max(300).optional(),
  phone: z.string().min(1).max(40).optional(),
  lat: latSchema,
  lng: lngSchema,
  imageId: z.string().min(1).nullable().optional(),
  order: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
};

const baseLocationSchema = z.object(locationFields);

/** Oficinas (type=office) exigen address y phone; futuras (type=future), no. */
export const createLocationSchema = baseLocationSchema.superRefine((value, ctx) => {
  if (value.type !== 'office') return;
  if (!value.address) {
    ctx.addIssue({ code: 'custom', path: ['address'], message: 'address es obligatorio para oficinas' });
  }
  if (!value.phone) {
    ctx.addIssue({ code: 'custom', path: ['phone'], message: 'phone es obligatorio para oficinas' });
  }
});

export const updateLocationSchema = baseLocationSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Envía al menos un campo para actualizar',
  });

export const listLocationsQuerySchema = z.object({
  type: z.enum(locationTypeValues).optional(),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type LocationTypeFe = (typeof locationTypeValues)[number];
