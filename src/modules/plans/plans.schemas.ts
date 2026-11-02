import { z } from 'zod';

/** Grupos en el vocabulario del frontend (minúsculas). */
export const planGroupValues = ['hogar', 'avanzado', 'empresarial'] as const;

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usa kebab-case: minúsculas, números y guiones');

const planFields = {
  slug: slugSchema,
  name: z.string().min(1).max(120),
  speed: z.number().int().min(0).max(100_000),
  price: z.number().min(0).max(1_000_000),
  segment: z.string().min(1).max(80),
  use: z.string().min(1).max(300),
  devices: z.string().min(1).max(160),
  group: z.enum(planGroupValues),
  order: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
};

export const createPlanSchema = z.object(planFields);

export const updatePlanSchema = createPlanSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Envía al menos un campo para actualizar',
  });

export const idOrSlugSchema = z.string().min(1, 'Id u slug obligatorio');

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
