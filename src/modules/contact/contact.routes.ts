import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../middleware/error.js';

/**
 * POST /api/contact — solicitud de preinstalación del sitio público.
 * Guarda el lead en la base de datos y lo reenvía a Wisphub como
 * multipart/form-data (mismo contrato que el curl de la documentación).
 * 
 * Logging estructurado: entrada de datos, procesamiento, envío a Wisphub,
 * y respuesta final (éxo o fallback local).
 */

export const contactRouter = Router();

// Los archivos viajan en memoria: se reenvían a Wisphub y no se guardan
// copias locales de documentos de identidad.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

// ── Multer: archivos en memoria, sin guardar copias locales ─────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: 3,
  },
});

// Configuración del rate limit con logging en eventos
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
const logRequestStart = (req: any) => {
  const safeBody = {
    ...req.body,
    // Omitir campos para ruido controlado (sin datos sensibles)
    front_dni_proof: undefined,
    back_dni_proof: undefined,
    proof_of_address: undefined,
    postal_code: undefined, // elimina campo postal del log
    coordenadas: req.body.coordenadas, // opcional, incluye si viene
  };
  logger.info(
    { method: req.method, url: req.originalUrl, body: safeBody },
    `Solicitud entrante en ${req.method} ${req.originalUrl}`
  );
};

logRequestStart.rateLimit = async (info: any) => {
  logger.warn(
    { ip: info.ip, currentCount: info.currentTotal, limit: info.limit },
    'Límite de tasa exceeded para contacto'
  );
};

/* ── Schema de validación ──────────────────────────────────────────── */
const contactSchema = z.object({
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

type ContactFields = z.infer<typeof contactSchema>;

/** Reenvía la solicitud a Wisphub con el mismo contrato del curl oficial. */
async function sendToWisphub(fields: ContactFields, files: Express.Multer.File[]): Promise<{ ok: boolean; status: number; body: string }> {
  if (!env.WISPHUB_API_KEY) {
    logger.warn('WISPHUB_API_KEY no configurada: la solicitud queda solo en base de datos');
    return { ok: false, status: 0, body: 'API key no configurada' };
  }

  const form = new FormData();
  form.set('firstname', fields.firstname);
  form.set('lastname', fields.lastname);
  form.set('address', fields.address);
  form.set('phone_number', fields.phone_number);
  form.set('email', fields.email);
  form.set('location', fields.location);
  form.set('city', fields.city);
  form.set('commentaries', fields.commentaries);
  if (fields.postal_code) form.set('postal_code', fields.postal_code);
  if (fields.coordenadas) form.set('coordenadas', fields.coordenadas);

  for (const file of files) {
    form.set(
      file.fieldname,
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
  }

  const res = await fetch(env.WISPHUB_API_URL, {
    method: 'POST',
    headers: { Authorization: `Api-Key ${env.WISPHUB_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });

  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

contactRouter.post(
  '/',
  contactLimiter,
  upload.fields([
    { name: 'front_dni_proof', maxCount: 1 },
    { name: 'back_dni_proof', maxCount: 1 },
    { name: 'proof_of_address', maxCount: 1 },
  ]),
  async (req, res, next) => {
    // Log de inicio de petición
    logRequestStart(req);

    try {
      const parsed = contactSchema.safeParse(req.body);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const detail = first ? `${first.path.join('.')}: ${first.message}` : 'Datos inválidos';
        logger.warn({ errors: parsed.error.issues }, 'Error de validación de esquema');
        throw new AppError(400, 'VALIDATION_ERROR', detail);
      }
      const fields = parsed.data;

      // Log: datos validados y procesados
      logger.info(
        { processed_fields: Object.keys(fields) },
        'Datos validados y procesados correctamente'
      );

      const filesByField = req.files as Record<string, Express.Multer.File[]> | undefined;
      const front = filesByField?.front_dni_proof?.[0];
      const back = filesByField?.back_dni_proof?.[0];
      const proof = filesByField?.proof_of_address?.[0];

      // Log: estado de archivos subidos
      logger.info(
        {
          files_received: { front_dni: !!front, back_dni: !!back, proof_address: !!proof },
          file_sizes: front ? front.size : null,
          file_mimes: front ? front.mimetype : null,
        },
        'Verificación de archivos adjuntos'
      );

      if (!front || !back || !proof) {
        logger.warn('Faltan archivos obligatorios (cédula o comprobante)');
        throw new AppError(400, 'ARCHIVOS_REQUERIDOS', 'Faltan las fotos de la cédula o el comprobante de domicilio.');
      }
      const files = [front, back, proof];

      // Log: creación de lead en base de datos
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
          status: 'pending',
        },
      });
      logger.info(
        { submissionId: submission.id, status: 'pending' },
        'Lead guardado en base de datos pending Wisphub'
      );

      let wisphub: { ok: boolean; status: number; body: string };
      try {
        logger.info(
          { submissionId: submission.id, api_url: env.WISPHUB_API_URL },
          'Enviando solicitud a Wisphub'
        );
        wisphub = await sendToWisphub(fields, files);
      } catch (err) {
        logger.error({ err, submissionId: submission.id }, 'Wisphub inalcanzable (excepción)');
        throw new AppError(
          502,
          'WISPHUB_INALCANZABLE',
          'El sistema de instalaciones no respondió. Tu solicitud quedó guardada y te contactaremos igualmente.',
        );
      }

      // Log: respuesta completa de Wisphub
      logger.info(
        {
          submissionId: submission.id,
          wisphub_ok: wisphub.ok,
          wisphub_status: wisphub.status,
          wisphub_body_preview: wisphub.body ? wisphub.body.slice(0, 200) : null,
        },
        'Respuesta recibida de Wisphub'
      );

      if (!wisphub.ok) {
        logger.warn(
          {
            status: wisphub.status,
            body_preview: wisphub.body ? wisphub.body.slice(0, 500) : null,
            submissionId: submission.id,
          },
          'Wisphub rechazó la solicitud'
        );
        throw new AppError(
          502,
          'WISPHUB_RECHAZO',
          'El sistema de instalaciones no aceptó la solicitud. Quedó guardada y te contactaremos para completarla.',
        );
      }

      // Actualizar status a enviado correctamente
      await prisma.contactSubmission.update({
        where: { id: submission.id },
        data: { status: 'sent_to_wisphub' },
      });
      logger.info(
        { submissionId: submission.id, final_status: 'sent_to_wisphub' },
        'Lead marcado como enviado a Wisphub exitosamente'
      );

      res.status(201).json({
        data: {
          id: submission.id,
          message: 'Solicitud recibida y enviada al sistema de instalaciones.',
        },
      });
      logger.info(
        { submissionId: submission.id, response_status: 201 },
        'Respuesta exitosa enviada al cliente'
      );
    } catch (err) {
      next(err);
    }
  },
);

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
  status: true,
  coordinates: true,
  wisphubSentAt: true,
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
  res.json({ data: submissions });
});

/** GET /api/admin/contact-submissions/:id — detalle de una solicitud. */
contactSubmissionsRouter.get('/:id', async (req, res) => {
  const submission = await prisma.contactSubmission.findUnique({
    where: { id: req.params.id },
    select: submissionSelect,
  });
  if (!submission) {
    throw new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada');
  }
  res.json({ data: submission });
});

const optionalText = (max: number) => z.string().trim().max(max).optional();

const migrateSchema = z.object({
  address: optionalText(300),
  location: optionalText(120),
  postal_code: z
    .string()
    .trim()
    .regex(/^[0-9]{4,8}$/, 'Código postal inválido')
    .optional()
    .or(z.literal('')),
});

/**
 * POST /api/admin/contact-submissions/:id/migrate
 * Reenvía a Wisphub una solicitud que quedó `pending`. Los datos que el
 * formulario público no guardaba (dirección, localidad, código postal y las
 * fotos) se completan desde el panel; el resto se toma de la base de datos.
 */
contactSubmissionsRouter.post(
  '/:id/migrate',
  upload.fields([
    { name: 'front_dni_proof', maxCount: 1 },
    { name: 'back_dni_proof', maxCount: 1 },
    { name: 'proof_of_address', maxCount: 1 },
  ]),
  async (req, res) => {
    const id = String(req.params.id);
    const submission = await prisma.contactSubmission.findUnique({ where: { id } });
    if (!submission) {
      throw new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada');
    }
    if (submission.status === 'sent_to_wisphub') {
      throw new AppError(409, 'ALREADY_SENT', 'Esta solicitud ya fue enviada a Wisphub.');
    }
    if (!submission.phone) {
      throw new AppError(400, 'MISSING_PHONE', 'La solicitud no tiene teléfono: no se puede enviar a Wisphub.');
    }

    const parsed = migrateSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const detail = first ? `${first.path.join('.')}: ${first.message}` : 'Datos inválidos';
      throw new AppError(400, 'VALIDATION_ERROR', detail);
    }

    const address = parsed.data.address || submission.address;
    const location = parsed.data.location || submission.location;
    if (!address || !location) {
      throw new AppError(400, 'MISSING_ADDRESS', 'Completa la dirección y el barrio/localidad antes de migrar.');
    }

    // El nombre se guardó como "Nombre Apellido(s)": lo separamos para Wisphub.
    const [firstname, ...rest] = submission.name.trim().split(/\s+/);
    const lastname = rest.join(' ');

    const filesByField = req.files as Record<string, Express.Multer.File[]> | undefined;
    const files = [
      filesByField?.front_dni_proof?.[0],
      filesByField?.back_dni_proof?.[0],
      filesByField?.proof_of_address?.[0],
    ].filter((file): file is Express.Multer.File => Boolean(file));

    const fields: ContactFields = {
      firstname: firstname || 'Cliente',
      lastname: lastname || firstname || 'AYR',
      address,
      phone_number: submission.phone,
      email: submission.email,
      location,
      city: submission.municipality,
      postal_code: parsed.data.postal_code || submission.postalCode || '',
      commentaries: submission.message,
      coordenadas: submission.coordinates ?? undefined,
    };

    let wisphub: { ok: boolean; status: number; body: string };
    try {
      wisphub = await sendToWisphub(fields, files);
    } catch (err) {
      const message = 'Wisphub no respondió. La solicitud sigue pendiente.';
      await prisma.contactSubmission.update({
        where: { id: submission.id },
        data: { wisphubError: message },
      });
      logger.error({ err, submissionId: submission.id }, 'Migración a Wisphub: inalcanzable');
      throw new AppError(502, 'WISPHUB_INALCANZABLE', message);
    }

    if (!wisphub.ok) {
      const detail = `Wisphub respondió ${wisphub.status}: ${wisphub.body.slice(0, 300)}`;
      await prisma.contactSubmission.update({
        where: { id: submission.id },
        data: { wisphubError: detail },
      });
      logger.warn(
        { submissionId: submission.id, status: wisphub.status, body: wisphub.body.slice(0, 500) },
        'Migración a Wisphub rechazada',
      );
      throw new AppError(
        502,
        'WISPHUB_RECHAZO',
        `Wisphub rechazó la solicitud (HTTP ${wisphub.status}). Revisa los datos o los adjuntos.`,
      );
    }

    const updated = await prisma.contactSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'sent_to_wisphub',
        wisphubSentAt: new Date(),
        wisphubError: null,
        address,
        location,
        postalCode: fields.postal_code || null,
      },
      select: submissionSelect,
    });

    logger.info(
      { submissionId: submission.id, status: 'sent_to_wisphub' },
      'Solicitud migrada a Wisphub desde el panel',
    );
    res.json({ data: updated });
  },
);