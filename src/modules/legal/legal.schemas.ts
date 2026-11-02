import { z } from 'zod';
import { slugSchema } from '../plans/plans.schemas.js';

/** Sección de un documento legal: `id` es el ancla `#id` del índice (kebab-case). */
export const legalSectionSchema = z.object({
  id: slugSchema,
  title: z.string().min(1).max(200),
  paragraphs: z.array(z.string().min(1).max(4000)).max(50).optional(),
  list: z.array(z.string().min(1).max(2000)).max(100).optional(),
  note: z.string().min(1).max(1000).optional(),
});

/** Guardar borrador (PUT): reemplaza las secciones; no toca fechas de publicación. */
export const saveDraftSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  sections: z.array(legalSectionSchema).min(1, 'El documento necesita al menos una sección'),
});

/** Publicar (POST /:slug/publish): opcionalmente guarda secciones antes de publicar. */
export const publishSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  summary: z.string().min(1).max(500).optional(),
  sections: z.array(legalSectionSchema).min(1).optional(),
});

export const slugParamSchema = z.object({ slug: slugSchema });

export type LegalSectionInput = z.infer<typeof legalSectionSchema>;
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
export type PublishInput = z.infer<typeof publishSchema>;
