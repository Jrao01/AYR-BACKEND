import { readFile } from 'node:fs/promises';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { AppError } from '../../middleware/error.js';
import type { ContactFields, MigrateInput } from './contact.schemas.js';
import { mimeForStoredFile, resolveStoredFile, storedFileExists } from './contact.storage.js';

/** Fila de `ContactSubmission` tal como la usan los servicios. */
export type ContactSubmissionRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  municipality: string;
  message: string;
  address: string | null;
  location: string | null;
  postalCode: string | null;
  frontDniProof: string | null;
  backDniProof: string | null;
  proofOfAddress: string | null;
  coordinates: string | null;
  status: string;
  wisphubSentAt: Date | null;
  wisphubSendingAt: Date | null;
  wisphubError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const ATTACHMENT_KINDS = ['front', 'back', 'proof'] as const;
export type ContactAttachmentKind = (typeof ATTACHMENT_KINDS)[number];

type AttachmentColumn = 'frontDniProof' | 'backDniProof' | 'proofOfAddress';

export const ATTACHMENT_META: Record<
  ContactAttachmentKind,
  { column: AttachmentColumn; field: string; label: string }
> = {
  front: { column: 'frontDniProof', field: 'front_dni_proof', label: 'Foto 1 de la cédula' },
  back: { column: 'backDniProof', field: 'back_dni_proof', label: 'Foto 2 de la cédula' },
  proof: { column: 'proofOfAddress', field: 'proof_of_address', label: 'Comprobante de domicilio' },
};

export type ContactSubmissionDto = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  municipality: string;
  address: string | null;
  location: string | null;
  postalCode: string | null;
  message: string;
  coordinates: string | null;
  status: string;
  wisphubSentAt: Date | null;
  wisphubSendingAt: Date | null;
  wisphubError: string | null;
  attachments: Record<ContactAttachmentKind, boolean>;
  createdAt: Date;
  updatedAt: Date;
};

/** Archivo listo para adjuntar al multipart de Wisphub. */
type OutgoingFile = {
  path: string;
  mimetype: string;
  originalname: string;
  fieldname: string;
};

export function toSubmissionDto(row: ContactSubmissionRow): ContactSubmissionDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    municipality: row.municipality,
    address: row.address,
    location: row.location,
    postalCode: row.postalCode,
    message: row.message,
    coordinates: row.coordinates,
    status: row.status,
    wisphubSentAt: row.wisphubSentAt,
    wisphubSendingAt: row.wisphubSendingAt,
    wisphubError: row.wisphubError,
    attachments: {
      front: storedFileExists(row.frontDniProof),
      back: storedFileExists(row.backDniProof),
      proof: storedFileExists(row.proofOfAddress),
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Wisphub exige nombre y apellido separados; el panel guarda uno solo. */
export function splitName(name: string): { firstname: string; lastname: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstname: 'Cliente', lastname: 'AYR' };
  if (parts.length === 1) return { firstname: parts[0] as string, lastname: parts[0] as string };
  return {
    firstname: parts[0] as string,
    lastname: parts.slice(1).join(' '),
  };
}

function missingAttachments(submission: ContactSubmissionRow): ContactAttachmentKind[] {
  return ATTACHMENT_KINDS.filter(
    (kind) => !storedFileExists(submission[ATTACHMENT_META[kind].column]),
  );
}

function assertAttachments(submission: ContactSubmissionRow): void {
  const missing = missingAttachments(submission);
  if (missing.length === 0) return;
  throw new AppError(
    400,
    'MISSING_ATTACHMENTS',
    `Faltan adjuntos obligatorios: ${missing.map((kind) => ATTACHMENT_META[kind].label).join(', ')}.`,
    { missing },
  );
}

function outgoingFiles(submission: ContactSubmissionRow): OutgoingFile[] {
  return ATTACHMENT_KINDS.map((kind) => {
    const meta = ATTACHMENT_META[kind];
    const fileName = submission[meta.column];
    const fullPath = resolveStoredFile(fileName);
    if (!fullPath || !fileName) {
      throw new AppError(
        400,
        'MISSING_ATTACHMENTS',
        `Falta el adjunto: ${meta.label}.`,
        { missing: [kind] },
      );
    }
    return {
      path: fullPath,
      mimetype: mimeForStoredFile(fileName),
      originalname: fileName,
      fieldname: meta.field,
    };
  });
}

/** Construye los campos que espera Wisphub a partir de la fila guardada. */
export function buildContactFields(
  submission: ContactSubmissionRow,
  overrides: MigrateInput = {},
): ContactFields {
  const { firstname, lastname } = splitName(submission.name);
  const phone = (submission.phone ?? '').trim();
  const address = (overrides.address || submission.address || '').trim();
  const location = (overrides.location || submission.location || '').trim();

  if (!phone) {
    throw new AppError(400, 'MISSING_PHONE', 'La solicitud no tiene teléfono: no se puede enviar a Wisphub.');
  }
  if (!address) {
    throw new AppError(400, 'MISSING_ADDRESS', 'Completa la dirección antes de enviar a Wisphub.');
  }
  if (!location) {
    throw new AppError(400, 'MISSING_LOCATION', 'Completa el barrio/localidad antes de enviar a Wisphub.');
  }

  return {
    firstname,
    lastname,
    address,
    phone_number: phone,
    email: submission.email,
    location,
    city: submission.municipality,
    postal_code: overrides.postal_code || submission.postalCode || '',
    commentaries: submission.message,
    coordenadas: submission.coordinates ?? undefined,
  };
}

/**
 * Wisphub procesa y valida las fotos antes de aceptar la solicitud; con
 * adjuntos reales de móvil (varios MB) la respuesta puede tardar bastante.
 */
const WISPHUB_TIMEOUT_MS = 60_000;

/** Convierte el cuerpo de error de Wisphub en un mensaje entendible. */
function describeWisphubError(status: number, body: string): string {
  const trimmed = body.trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const messages: string[] = [];
        for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) {
          const texts = Array.isArray(value) ? value : [value];
          for (const text of texts) {
            if (typeof text === 'string' && text.trim()) {
              messages.push(field === 'non_field_errors' ? text.trim() : `${field}: ${text.trim()}`);
            }
          }
        }
        if (messages.length > 0) {
          return `Wisphub rechazó la solicitud: ${messages.join(' · ')}`;
        }
      }
    } catch {
      // Cuerpo no parseable: se usa el mensaje genérico de abajo.
    }
  }

  if (status >= 500 || trimmed.startsWith('<')) {
    return `Wisphub devolvió un error interno (HTTP ${status}). Intenta de nuevo en unos minutos.`;
  }
  return `Wisphub rechazó la solicitud (HTTP ${status}). Revisa los datos o los adjuntos.`;
}

/** Reenvía la solicitud a Wisphub con el mismo contrato del curl oficial. */
async function sendToWisphub(
  fields: ContactFields,
  files: OutgoingFile[],
): Promise<{ ok: boolean; status: number; body: string }> {
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

  // Adjunta los archivos. Los mismos fueron validados previamente por
  // `assertAttachments` y `outgoingFiles` (en `sendSubmissionToWisphub`), pero
  // añadimos una verificación final aquí como última capa de defensa para que
  // cualquier inconsistencia de ruta o permiso sea devuelta como AppError (con
  // header CORS) en lugar de causar un 502 silencioso de Nginx.
  for (const file of files) {
    // Ya valida que el archivo existe y es legible; si no, lanza AppError.
    if (!storedFileExists(file.originalname)) {
      throw new AppError(400, 'FILE_NOT_FOUND', `El archivo adjunto no se encuentra: ${file.originalname}`);
    }

    // Se lee a memoria y se convierte a Blob. Evita `openAsBlob` (experimental
    // en Node) que provocaba fallos al construir el multipart.
    try {
      const buffer = await readFile(file.path);
      const blob = new Blob([new Uint8Array(buffer)], { type: file.mimetype });
      form.set(file.fieldname, blob, file.originalname);
    } catch (err) {
      logger.error({ err, file: file.path }, 'Error al leer archivo adjunto');
      throw new AppError(500, 'FILE_READ_ERROR', `No se pudo leer el archivo adjunto: ${file.originalname}`);
    }
  }

  const startedAt = Date.now();

  try {
    const res = await fetch(env.WISPHUB_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Api-Key ${env.WISPHUB_API_KEY}`,
        Accept: 'application/json',
      },
      body: form,
      signal: AbortSignal.timeout(WISPHUB_TIMEOUT_MS),
    });

    const body = await res.text();
    logger.info(
      { ok: res.ok, status: res.status, ms: Date.now() - startedAt },
      'Respuesta de Wisphub',
    );
    if (!res.ok) {
      logger.warn(
        { status: res.status, bodyPreview: body.slice(0, 500) },
        'Wisphub devolvió un error',
      );
    }

    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    // Errores de red, timeouts o fallos de fetch: convertimos en AppError
    // para mantener headers CORS consistentes y que el panel muestre un
    // mensaje en lugar de que Nginx devuelva un 502 sin headers.
    logger.error({ err }, 'Error de red o timeout al conectar con la API de Wisphub');
    throw new AppError(
      502,
      'WISPHUB_UNREACHABLE',
      'No se pudo comunicar con el servidor de Wisphub (timeout o error de red).',
    );
  }
}

/** Un envío que quedó colgado más de este tiempo puede reintentarse. */
const SENDING_STALE_MS = 2 * 60 * 1000;

/**
 * Reclama la solicitud de forma atómica. Evita que el envío en segundo plano
 * y el botón del panel manden la misma solicitud dos veces.
 */
async function claimForSending(id: string): Promise<void> {
  const stale = new Date(Date.now() - SENDING_STALE_MS);
  const claimed = await prisma.contactSubmission.updateMany({
    where: {
      id,
      status: { not: 'sent_to_wisphub' },
      OR: [{ wisphubSendingAt: null }, { wisphubSendingAt: { lt: stale } }],
    },
    data: { wisphubSendingAt: new Date() },
  });

  if (claimed.count > 0) return;

  const current = await prisma.contactSubmission.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!current) {
    throw new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada');
  }
  if (current.status === 'sent_to_wisphub') {
    throw new AppError(409, 'ALREADY_SENT', 'Esta solicitud ya fue enviada a Wisphub.');
  }
  throw new AppError(
    409,
    'ENVIO_EN_CURSO',
    'La solicitud se está enviando. Espera unos segundos e intenta de nuevo.',
  );
}

/** Libera el lock y, si aplica, guarda el error del intento. */
async function releaseClaim(id: string, error: string | null): Promise<void> {
  await prisma.contactSubmission
    .update({
      where: { id },
      data: {
        wisphubSendingAt: null,
        ...(error !== null ? { wisphubError: error } : {}),
      },
    })
    .catch((err) => logger.error({ err, submissionId: id }, 'No se pudo liberar el lock de Wisphub'));
}

/**
 * Envía una solicitud usando los datos y los adjuntos ya guardados.
 * Lanza `AppError` con un mensaje claro para el panel.
 */
export async function sendSubmissionToWisphub(
  id: string,
  overrides: MigrateInput = {},
): Promise<ContactSubmissionDto> {
  await claimForSending(id);
  const startedAt = Date.now();

  try {
    const submission = await prisma.contactSubmission.findUnique({ where: { id } });
    if (!submission) {
      throw new AppError(404, 'NOT_FOUND', 'Solicitud no encontrada');
    }

    assertAttachments(submission);
    const fields = buildContactFields(submission, overrides);
    const files = outgoingFiles(submission);

    let wisphub: { ok: boolean; status: number; body: string };
    try {
      logger.info({ submissionId: id, api_url: env.WISPHUB_API_URL }, 'Enviando solicitud a Wisphub');
      wisphub = await sendToWisphub(fields, files);
    } catch (err) {
      logger.error({ err, submissionId: id, ms: Date.now() - startedAt }, 'Wisphub inalcanzable');
      if (err instanceof AppError) throw err;
      throw new AppError(
        502,
        'WISPHUB_INALCANZABLE',
        'Wisphub no respondió. La solicitud sigue pendiente.',
      );
    }

    logger.info(
      {
        submissionId: id,
        wisphub_ok: wisphub.ok,
        wisphub_status: wisphub.status,
        ms: Date.now() - startedAt,
      },
      'Respuesta recibida de Wisphub',
    );

    if (!wisphub.ok) {
      logger.warn({ submissionId: id, status: wisphub.status }, 'Wisphub rechazó la solicitud');
      const message =
        wisphub.status === 0
          ? 'Wisphub no está configurado (falta WISPHUB_API_KEY).'
          : describeWisphubError(wisphub.status, wisphub.body);
      // Un rechazo por datos (4xx) no es una caída del servicio.
      const status = wisphub.status >= 400 && wisphub.status < 500 ? 422 : 502;
      throw new AppError(status, 'WISPHUB_RECHAZO', message, { wisphubStatus: wisphub.status });
    }

    const updated = await prisma.contactSubmission.update({
      where: { id },
      data: {
        status: 'sent_to_wisphub',
        wisphubSentAt: new Date(),
        wisphubSendingAt: null,
        wisphubError: null,
        ...(overrides.address ? { address: overrides.address } : {}),
        ...(overrides.location ? { location: overrides.location } : {}),
        ...(overrides.postal_code !== undefined
          ? { postalCode: overrides.postal_code || null }
          : {}),
      },
    });

    logger.info(
      { submissionId: id, status: 'sent_to_wisphub', ms: Date.now() - startedAt },
      'Lead marcado como enviado a Wisphub',
    );
    return toSubmissionDto(updated);
  } catch (err) {
    // Guardamos el motivo cuando el fallo proviene de Wisphub (o es inesperado),
    // pero no cuando es un error de datos del propio formulario.
    const wisphubFailure =
      err instanceof AppError && (err.status >= 500 || err.code.startsWith('WISPHUB_'));
    const message =
      wisphubFailure || !(err instanceof AppError)
        ? err instanceof Error
          ? err.message
          : 'Error inesperado al enviar a Wisphub'
        : null;
    await releaseClaim(id, message);
    throw err;
  }
}

/** Envío en segundo plano: nunca propaga el error al request del usuario. */
export async function syncToWisphub(id: string): Promise<void> {
  try {
    await sendSubmissionToWisphub(id);
  } catch (err) {
    logger.warn({ err, submissionId: id }, 'Envío en segundo plano a Wisphub no completado');
  }
}
