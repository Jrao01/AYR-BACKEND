import { z } from 'zod';

/** Campos del formulario público de preinstalación. */
export const contactSchema = z.object({
  firstname: z.string().trim().min(1, 'Escribe el nombre').max(80, 'Máximo 80 caracteres'),
  lastname: z.string().trim().min(1, 'Escribe el apellido').max(80, 'Máximo 80 caracteres'),
  address: z.string().trim().min(1, 'Indica la dirección').max(300, 'Máximo 300 caracteres'),
  phone_number: z.string().trim().regex(/^[0-9+\s-]{7,15}$/, 'Teléfono inválido'),
  email: z.string().trim().email('Correo inválido').max(160, 'Máximo 160 caracteres'),
  location: z.string().trim().min(1, 'Indica el barrio o localidad').max(120, 'Máximo 120 caracteres'),
  city: z.string().trim().min(1, 'Indica la ciudad o municipio').max(120, 'Máximo 120 caracteres'),
  postal_code: z.string().trim().regex(/^[0-9]{4,8}$/, 'Código postal inválido').optional().or(z.literal('')),
  commentaries: z
    .string()
    .trim()
    .min(1, 'Cuéntanos algo sobre la preinstalación')
    .max(2000, 'Máximo 2000 caracteres'),
  coordenadas: z
    .string()
    .trim()
    .regex(/^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/, 'Formato "lat,lng"')
    .optional(),
});

export type ContactFields = z.infer<typeof contactSchema>;

const optionalText = (max: number) => z.string().trim().max(max).optional();

const postalCode = z
  .string()
  .trim()
  .regex(/^[0-9]{4,8}$/, 'Código postal inválido')
  .optional()
  .or(z.literal(''));

const coordinates = z
  .string()
  .trim()
  .regex(/^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/, 'Formato "lat,lng"')
  .optional()
  .or(z.literal(''));

/**
 * Overrides opcionales de `POST /:id/migrate`. Los registros nuevos ya traen
 * dirección y localidad; esto queda para los antiguos.
 */
export const migrateSchema = z.object({
  address: optionalText(300),
  location: optionalText(120),
  postal_code: postalCode,
});

export type MigrateInput = z.infer<typeof migrateSchema>;

/** Campos editables desde el panel. Los vacíos limpian el valor en BD. */
export const updateSubmissionSchema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre').max(160, 'Máximo 160 caracteres').optional(),
  email: z.string().trim().email('Correo inválido').max(160, 'Máximo 160 caracteres').optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\s-]{7,15}$/, 'Teléfono inválido')
    .optional()
    .or(z.literal('')),
  municipality: z.string().trim().min(1, 'Indica el municipio').max(120, 'Máximo 120 caracteres').optional(),
  address: optionalText(300),
  location: optionalText(120),
  postalCode,
  message: z.string().trim().min(1, 'Escribe un comentario').max(2000, 'Máximo 2000 caracteres').optional(),
  coordinates,
});

export type UpdateSubmissionInput = z.infer<typeof updateSubmissionSchema>;
