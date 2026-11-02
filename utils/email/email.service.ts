import fs from 'node:fs';
import { Resend } from 'resend';
import { LOGO_CID, MAIL_FROM, MAIL_REPLY_TO, resolveLogoPath } from './brand.ts';
import { normalizeOtp, renderOtpHtml, renderOtpText, type OtpEmailData } from './otp.template.ts';

export type SendOtpInput = OtpEmailData & {
  /** Destinatario(s). */
  to: string | string[];
  /** API key de Resend (re_...). */
  apiKey: string;
  /** Remitente; por defecto "AyrNetworx <admin@ayrnetworxv.ve>". */
  from?: string;
  /** Reply-to; por defecto soporte@ayrnetworxv.ve. */
  replyTo?: string;
  /** Asunto; por defecto "Código de verificación - AyrNetworx". */
  subject?: string;
  /** Clave de idempotencia; por defecto se deriva del destinatario + código + minuto. */
  idempotencyKey?: string;
};

export type SendOtpResult =
  | { ok: true; id: string; to: string; htmlBytes: number }
  | { ok: false; error: string; code: string | null; status: number | null };

/**
 * Gmail recorta ("clipping") los mensajes cuyo HTML supera ~102 KB.
 * Se valida antes de llamar a la API para no gastar cuota en un correo truncado.
 */
export const GMAIL_CLIP_BYTES = 102 * 1024;

/** Descripción accionable para cada código de error de la API de Resend. */
const ERROR_HINTS: Record<string, string> = {
  missing_api_key: 'Falta la API key de Resend (empieza por "re_").',
  invalid_api_key: 'La API key de Resend es inválida o fue revocada.',
  restricted_api_key: 'La API key no tiene permiso de envío (scope "sending_access").',
  validation_error: 'Resend rechazó el payload (revisa remitente, destinatario y contenido).',
  invalid_from_address: 'El remitente no está verificado en el dominio de Resend.',
  invalid_attachment: 'El adjunto (logo) es inválido o excede el tamaño permitido.',
  missing_required_field: 'Falta un campo obligatorio en el payload.',
  invalid_parameter: 'Algún parámetro del payload es inválido.',
  invalid_access: 'Sin acceso a ese recurso.',
  not_found: 'Recurso no encontrado en Resend.',
  rate_limit_exceeded: 'Se excedió el límite de peticiones. Reintenta en unos segundos.',
  daily_quota_exceeded: 'Se agotó la cuota diaria del plan (plan gratuito: 100 correos/día).',
  monthly_quota_exceeded: 'Se agotó la cuota mensual del plan.',
  application_error: 'Error interno de Resend. Reintenta en unos minutos.',
  internal_server_error: 'Error interno de Resend. Reintenta en unos minutos.',
  security_error: 'Resend bloqueó el envío por una regla de seguridad.',
  message_too_large: 'El HTML supera ~102 KB y Gmail lo recortaría. Reduce la plantilla o el contenido dinámico.',
};

/** Pistas por código HTTP: Resend devuelve nombres genéricos (ej. "validation_error") en varios casos. */
const STATUS_HINTS: Record<number, string> = {
  400: 'Payload inválido: revisa remitente, destinatario, adjuntos y contenido.',
  401: 'La API key de Resend es inválida o fue revocada.',
  403: 'Sin permiso: verifica que el dominio remitente esté verificado en Resend.',
  404: 'Recurso no encontrado en Resend.',
  422: 'Payload inválido: revisa remitente, destinatario, adjuntos y contenido.',
  429: 'Se excedió el límite de peticiones. Reintenta en unos segundos.',
};

/** Clave de idempotencia estable: mismo destinatario + mismo código en el mismo minuto. */
function defaultIdempotencyKey(to: string[], code: string): string {
  const minute = Math.floor(Date.now() / 60_000);
  return `ayr-otp-${code}-${to.join('|')}-${minute}`.slice(0, 256);
}

/** Carga el logo AYR como adjunto inline (content-id) para renderizarlo vía cid:. */
function buildLogoAttachment(): { filename: string; content: Buffer; contentType: string; contentId: string }[] {
  const logoPath = resolveLogoPath();
  if (!logoPath) return [];
  return [
    {
      filename: 'ayr-logo-blanco.png',
      content: fs.readFileSync(logoPath),
      contentType: 'image/png',
      contentId: LOGO_CID,
    },
  ];
}

/**
 * Envía el correo OTP de 8 dígitos.
 * Nunca lanza: devuelve un resultado discriminable para que el CLI controle el exit code.
 */
export async function sendOtpEmail(input: SendOtpInput): Promise<SendOtpResult> {
  const to = Array.isArray(input.to) ? input.to : [input.to];
  if (to.length === 0) {
    return { ok: false, error: 'No se indicó ningún destinatario.', code: 'missing_required_field', status: null };
  }
  if (!input.apiKey.trim()) {
    return { ok: false, error: ERROR_HINTS.missing_api_key!, code: 'missing_api_key', status: null };
  }

  let code: string;
  try {
    code = normalizeOtp(input.code);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Código OTP inválido.',
      code: 'validation_error',
      status: null,
    };
  }

  const html = renderOtpHtml({ ...input, code });
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > GMAIL_CLIP_BYTES) {
    return {
      ok: false,
      error: `El HTML pesa ${(htmlBytes / 1024).toFixed(1)} KB → ${ERROR_HINTS.message_too_large}`,
      code: 'message_too_large',
      status: null,
    };
  }

  const resend = new Resend(input.apiKey);
  const attachments = buildLogoAttachment();

  const { data, error } = await resend.emails.send(
    {
      from: input.from ?? MAIL_FROM,
      to,
      replyTo: input.replyTo ?? MAIL_REPLY_TO,
      subject: input.subject ?? 'Código de verificación - AyrNetworx',
      html,
      text: renderOtpText({ ...input, code }),
      attachments,
      tags: [
        { name: 'categoria', value: 'otp' },
        { name: 'plantilla', value: 'otp-8-digitos' },
        { name: 'marca', value: 'ayr' },
      ],
    },
    { idempotencyKey: input.idempotencyKey ?? defaultIdempotencyKey(to, code) },
  );

  if (error) {
    const status = typeof error.statusCode === 'number' ? error.statusCode : null;
    const name = typeof error.name === 'string' ? error.name : null;
    // Un 401 siempre es la API key, aunque Resend lo etiquete como "validation_error".
    const code = status === 401 ? 'invalid_api_key' : name;
    const hint = (status !== null ? STATUS_HINTS[status] : undefined) ?? (code ? ERROR_HINTS[code] : undefined);
    const detail = error.message || 'Error desconocido de Resend.';
    return {
      ok: false,
      error: hint ? `${detail} → ${hint}` : detail,
      code,
      status,
    };
  }

  if (!data) {
    return { ok: false, error: 'Resend no devolvió el identificador del correo.', code: null, status: null };
  }

  return { ok: true, id: data.id, to: to.join(', '), htmlBytes };
}
