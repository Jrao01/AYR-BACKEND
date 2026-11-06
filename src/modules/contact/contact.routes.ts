import path from 'node:path';
import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../middleware/error.js';
import { contactSchema, migrateSchema, updateSubmissionSchema } from './contact.schemas.js';
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_META,
  sendSubmissionToWisphub,
  syncToWisphub,
  toSubmissionDto,
  type ContactAttachmentKind,
  type ContactSubmissionRow,
} from './contact.service.js';
import {
  cleanupFiles,
  contactUpload,
  deleteStoredFile,
  mimeForStoredFile,
  resolveStoredFile,
  storedFileExists,
  uploadedFiles,
} from './contact.storage.js';

/**
 * POST /api/contact — solicitud de preinstalación del sitio público.
 * Guarda el lead y sus adjuntos en almacenamiento privado, responde de
 * inmediato (202) y reenvía a Wisphub en segundo plano.
 */

export const contactRouter = Router();

const ATTACHMENT_FIELDS = [
  { name: 'front_dni_proof', maxCount: 1 },
  { name: 'back_dni_proof', maxCount: 1 },
  { name: 'proof_of_address', maxCount: 1 },
];

/** Rate limit del formulario público. */
const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Demasiadas solicitudes seguidas. Intenta en unos minutos o escríbenos por WhatsApp.',
    },
  },
});

/* ── Logging de entrada de petición ────────────────────────────────── */
const logRequestStart = (req: Request) => {
  const safeBody = {
    ...req.body,
    // Omitir campos para ruido controlado (sin datos sensibles)
    front_dni_proof: undefined,
    back_dni_proof: undefined,
    proof_of_address: undefined,
    postal_code: undefined,
    coordenadas: req.body?.coordenadas,
  };
  logger.info(
    { method: req.method, url: req.originalUrl, body: safeBody },
    `Solicitud entrante en ${req.method} ${req.originalUrl}`,
  );
};

type FilesByField = Record<string, Express.Multer.File[]> | undefined;

function fileFor(req: Request, field: string): Express.Multer.File | undefined {
  return (req.files as FilesByField)?.[field]?.[0];
}

/** Adjuntos nuevos de la petición, con la columna que reemplazan. */
function collectReplacements(req: Request): Array<{
  kind: ContactAttachmentKind;
  file: Express.Multer.File;
  column: 'frontDniProof' | 'backDniProof' | 'proofOfAddress';
}> {
  const replacements: Array<{
    kind: ContactAttachmentKind;
    file: Express.Multer.File;
    column: 'frontDniProof' | 'backDniProof' | 'proofOfAddress';
  }> = [];

  for (const kind of ATTACHMENT_KINDS) {
    const meta = ATTACHMENT_META[kind];
    const file = fileFor(req, meta.field);
    if (file) replacements.push({ kind, file, column: meta.column });
  }

  return replacements;
}

function validationError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): AppError {
  const first = error.issues[0];
  const detail = first ? `${first.path.join('.')}: ${first.message}` : 'Datos inválidos';
  return new AppError(400, 'VALIDATION_ERROR', detail);
}

contactRouter.post('/', contactLimiter, contactUpload.fields(ATTACHMENT_FIELDS), async (req, res, next) => {
  const startedAt = Date.now();
  logRequestStart(req);

  const uploaded = uploadedFiles(req);

  try {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ errors: parsed.error.issues }, 'Error de validación de esquema');
      throw validationError(parsed.error);
    }
    const fields = parsed.data;

    const front = fileFor(req, 'front_dni_proof');
    const back = fileFor(req, 'back_dni_proof');
    const proof = fileFor(req, 'proof_of_address');

    if (!front || !back || !proof) {
      logger.warn('Faltan archivos obligatorios (cédula o comprobante)');
      throw new AppError(
        400,
        'ARCHIVOS_REQUERIDOS',
        'Faltan las fotos de la cédula o el comprobante de domicilio.',
      );
    }

    const submission = await prisma.contactSubmission.create({
      data: {
        name: `${fields.firstname} ${fields.lastname}`,
        email: fields.email,
        phone: fields.phone_number,
        municipality: fields.city,
        message: fields.commentaries,
        address: fields.address,
        location: fields.location,
        postalCode: fields.postal_code || null,
        coordinates: fields.coordenadas ?? null,
        frontDniProof: front.filename,
        backDniProof: back.filename,
        proofOfAddress: proof.filename,
        status: 'pending',
      },
    });

    logger.info(
      {
        submissionId: submission.id,
        status: 'pending',
        ms: Date.now() - startedAt,
        rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      'Lead guardado en base de datos pending Wisphub',
    );

    // Responder de inmediato: el proxy/Cloudflare nunca espera a Wisphub.
    res.status(202).json({
      data: {
        id: submission.id,
        message: 'Solicitud recibida. El sistema de instalaciones la procesará en breve.',
      },
    });
    logger.info(
      { submissionId: submission.id, response_status: 202, ms: Date.now() - startedAt },
      'Respuesta enviada al cliente',
    );

    // Fire-and-forget: usa los adjuntos ya persistidos.
    void syncToWisphub(submission.id);
  } catch (err) {
    if (res.headersSent) {
      logger.error({ err }, 'Error después de responder al cliente');
      return;
    }
    await cleanupFiles(uploaded);
    next(err);
  }
});

/* ── Rutas admin: solicitudes de contacto ─────────────────────────────── */

export const contactSubmissionsRouter = Router();

/** Campos que devuelve el panel (lista y detalle usan el mismo shape). */
const submissionSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  municipality: true,
  address: true,
  location: true,
  postalCode: true,
  message: true,
  coordinates: true,
  status: true,
  frontDniProof: true,
  backDniProof: true,
  proofOfAddress: true,
  wisphubSentAt: true,
  wisphubSendingAt: true,
  wisphubError: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** GET /api/admin/contact-submissions — listar (opcional: ?status=...). */
contactSubmissionsRouter.get('/', async (req, res) => {
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
  const submissions = await prisma.contactSubmission.findMany({
    where: statusFilter ? { status: statusFilter } : {},
    orderBy: { createdAt: 'desc' },
    select: submissionSelect,
  });
  res.json({ data: submissions.map((row) => toSubmissionDto(row as ContactSubmissionRow)) });
});

/** GET /api/admin/contact-submissions/:id/attachments/:kind — adjunto privado. */
contactSubmissionsRouter.get('/:id/attachments/:kind', async (req, res) => {
  const kind = String(req.params.kind) as ContactAttachmentKind;
  if (!ATTACHMENT_KINDS.includes(kind)) {
    throw new AppError(400, 'ADJUNTO_INVALIDO', 'Tipo de adjunto inválido. Usa front, back o proof.');
  }

  const meta = ATTACHMENT_META[kind];
  const submission = await prisma.contactSubmission.findUnique({
    where: { id: String(req.params.id) },
    select: { frontDniProof: true, backDniProof: true, proofOfAddress: true },
  });
  if (!submission) {
    throw new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada');
  }

  const fileName = submission[meta.column];
  const fullPath = resolveStoredFile(fileName);
  if (!fileName || !fullPath || !storedFileExists(fileName)) {
    throw new AppError(404, 'ADJUNTO_NO_ENCONTRADO', 'El adjunto no está disponible.');
  }

  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(fullPath)}"`);
  res.type(mimeForStoredFile(fileName));
  res.sendFile(fullPath);
});

/** GET /api/admin/contact-submissions/:id — detalle de una solicitud. */
contactSubmissionsRouter.get('/:id', async (req, res) => {
  const submission = await prisma.contactSubmission.findUnique({
    where: { id: String(req.params.id) },
    select: submissionSelect,
  });
  if (!submission) {
    throw new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada');
  }
  res.json({ data: toSubmissionDto(submission as ContactSubmissionRow) });
});

/**
 * PATCH /api/admin/contact-submissions/:id
 * Edita los datos que registró el cliente y permite reemplazar sus adjuntos.
 * Las solicitudes ya enviadas a Wisphub quedan de solo lectura.
 */
contactSubmissionsRouter.patch('/:id', contactUpload.fields(ATTACHMENT_FIELDS), async (req, res, next) => {
  const uploaded = uploadedFiles(req);
  let persisted = false;

  try {
    const id = String(req.params.id);
    const submission = await prisma.contactSubmission.findUnique({ where: { id } });
    if (!submission) {
      throw new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada');
    }
    if (submission.status === 'sent_to_wisphub') {
      throw new AppError(
        409,
        'ALREADY_SENT',
        'Esta solicitud ya fue enviada a Wisphub y no se puede editar.',
      );
    }

    const parsed = updateSubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }
    const data = parsed.data;
    const replacements = collectReplacements(req);

    if (Object.keys(data).length === 0 && replacements.length === 0) {
      throw new AppError(400, 'SIN_CAMBIOS', 'Envía al menos un campo o un adjunto para actualizar.');
    }

    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.email !== undefined) update.email = data.email;
    if (data.phone !== undefined) update.phone = data.phone || null;
    if (data.municipality !== undefined) update.municipality = data.municipality;
    if (data.address !== undefined) update.address = data.address || null;
    if (data.location !== undefined) update.location = data.location || null;
    if (data.postalCode !== undefined) update.postalCode = data.postalCode || null;
    if (data.message !== undefined) update.message = data.message;
    if (data.coordinates !== undefined) update.coordinates = data.coordinates || null;

    const previousFiles: Array<string | null> = [];
    for (const replacement of replacements) {
      previousFiles.push(submission[replacement.column]);
      update[replacement.column] = replacement.file.filename;
    }

    const updated = await prisma.contactSubmission.update({
      where: { id },
      data: update,
      select: submissionSelect,
    });
    persisted = true;

    // Los archivos anteriores solo se borran cuando la BD ya apunta a los nuevos.
    await Promise.all(previousFiles.map((fileName) => deleteStoredFile(fileName)));

    logger.info(
      { submissionId: id, fields: Object.keys(data), attachments: replacements.map((r) => r.kind) },
      'Solicitud editada desde el panel',
    );
    res.json({ data: toSubmissionDto(updated as ContactSubmissionRow) });
  } catch (err) {
    if (!persisted) await cleanupFiles(uploaded);
    next(err);
  }
});

/**
 * POST /api/admin/contact-submissions/:id/migrate
 * Reenvía a Wisphub usando los datos y adjuntos ya guardados. No requiere
 * body; sigue aceptando overrides para registros antiguos.
 */
contactSubmissionsRouter.post(
  '/:id/migrate',
  contactUpload.fields(ATTACHMENT_FIELDS),
  async (req, res, next) => {
    const uploaded = uploadedFiles(req);
    let persisted = false;

    try {
      const id = String(req.params.id);
      const submission = await prisma.contactSubmission.findUnique({ where: { id } });
      if (!submission) {
        throw new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada');
      }
      if (submission.status === 'sent_to_wisphub') {
        throw new AppError(409, 'ALREADY_SENT', 'Esta solicitud ya fue enviada a Wisphub.');
      }

      const parsed = migrateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw validationError(parsed.error);
      }

      // Adjuntos opcionales (registros antiguos): se guardan antes de enviar.
      const replacements = collectReplacements(req);
      if (replacements.length > 0) {
        const update: Record<string, unknown> = {};
        for (const replacement of replacements) {
          update[replacement.column] = replacement.file.filename;
        }
        await prisma.contactSubmission.update({ where: { id }, data: update });
        persisted = true;
        await Promise.all(
          replacements.map((replacement) => deleteStoredFile(submission[replacement.column])),
        );
      }

      const updated = await sendSubmissionToWisphub(id, parsed.data);
      logger.info({ submissionId: id }, 'Solicitud migrada a Wisphub desde el panel');
      res.json({ data: updated });
    } catch (err) {
      if (!persisted) await cleanupFiles(uploaded);
      next(err);
    }
  },
);
