import fs from 'node:fs';
import { LOGO_CID, MAIL_FROM, MAIL_REPLY_TO, resolveLogoPath } from './brand.ts';
import { renderOtpHtml, renderOtpText, type OtpEmailData } from './otp.template.ts';

export type EmlOptions = OtpEmailData & {
  /** Destinatario. */
  to: string;
  /** Remitente; por defecto "AyrNetworx <admin@ayrnetworxv.ve>". */
  from?: string;
  /** Reply-to; por defecto soporte@ayrnetworxv.ve. */
  replyTo?: string;
  /** Asunto; por defecto "Código de verificación - AyrNetworx". */
  subject?: string;
  /** Fecha del encabezado Date. */
  date?: Date;
  /** Message-ID; por defecto se genera. */
  messageId?: string;
  /** Adjunta el logo inline (cid:). Desactívalo para medir el peso del texto. */
  inlineLogo?: boolean;
};

export type EmlResult = {
  /** Mensaje completo listo para SMTP (CRLF). */
  raw: string;
  /** Message-ID usado. */
  messageId: string;
  /** Tamaño en bytes del mensaje. */
  bytes: number;
};

/** Umbral de recorte de Gmail: por encima de 102 KB el mensaje se muestra truncado. */
export const GMAIL_CLIP_BYTES = 102 * 1024;

/**
 * Codifica un valor de encabezado según RFC 2047 si contiene caracteres no ASCII.
 * Devuelve el texto tal cual si es ASCII puro.
 */
export function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const chunks: string[] = [];
  // 39 bytes de payload por chunk keeps the encoded-word under the 75-char limit.
  for (let i = 0; i < value.length; ) {
    const slice = value.slice(i, i + 39);
    chunks.push(`=?UTF-8?B?${Buffer.from(slice, 'utf8').toString('base64')}?=`);
    i += 39;
  }
  return chunks.join(' ');
}

/** Base64 con saltos de línea cada 76 caracteres (límite MIME). */
export function toBase64Lines(content: Buffer | string): string {
  const base64 = Buffer.isBuffer(content) ? content.toString('base64') : Buffer.from(content, 'utf8').toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 76) {
    lines.push(base64.slice(i, i + 76));
  }
  return lines.join('\r\n');
}

/** Genera un Message-ID único y determinista por segundo. */
function buildMessageId(date: Date): string {
  const stamp = date.toISOString().replace(/[-:.]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 10);
  return `<otp.${stamp}.${random}@ayrnetworxv.ve>`;
}

/**
 * Construye el mensaje OTP completo en formato MIME, con la misma estructura
 * que produce la API de Resend: multipart/alternative con text/plain y un
 * multipart/related que lleva el HTML más el logo inline.
 *
 * Sirve para enviar por SMTP (Stalwart, Resend SMTP) y para importar en
 * Thunderbird, de modo que la prueba A/B use exactamente el mismo contenido.
 */
export function buildOtpEml(options: EmlOptions): EmlResult {
  const date = options.date ?? new Date();
  const messageId = options.messageId ?? buildMessageId(date);
  const from = options.from ?? MAIL_FROM;
  const replyTo = options.replyTo ?? MAIL_REPLY_TO;
  const subject = options.subject ?? 'Código de verificación - AyrNetworx';
  const includeLogo = options.inlineLogo ?? true;

  const html = renderOtpHtml(options);
  const text = renderOtpText(options);

  const altBoundary = `----=_AYR_alt_${messageId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
  const relBoundary = `----=_AYR_rel_${messageId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;

  const logoPath = includeLogo ? resolveLogoPath() : null;

  const headers = [
    `From: ${from}`,
    `To: ${options.to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
  ];

  const textPart = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    toQuotedPrintable(text),
  ];

  const relatedPart = [
    `--${altBoundary}`,
    `Content-Type: multipart/related; type="text/html"; boundary="${relBoundary}"`,
    '',
    `--${relBoundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    toQuotedPrintable(html),
  ];

  const logoPart = logoPath
    ? [
        `--${relBoundary}`,
        'Content-Type: image/png; name="ayr-logo-blanco.png"',
        'Content-Transfer-Encoding: base64',
        `Content-ID: <${LOGO_CID}>`,
        'Content-Disposition: inline; filename="ayr-logo-blanco.png"',
        '',
        toBase64Lines(fs.readFileSync(logoPath)),
      ]
    : [];

  const body = [
    ...textPart,
    ...relatedPart,
    ...logoPart,
    `--${relBoundary}--`,
    `--${altBoundary}--`,
  ];

  const raw = `${headers.join('\r\n')}\r\n\r\n${body.join('\r\n')}\r\n`;
  return { raw, messageId, bytes: Buffer.byteLength(raw, 'utf8') };
}

/** Codifica un texto como quoted-printable (compatible con UTF-8). */
export function toQuotedPrintable(input: string): string {
  const buffer = Buffer.from(input, 'utf8');
  const lines: string[] = [];
  let line = '';

  const flush = (soft: boolean): void => {
    lines.push(soft ? `${line}=` : line);
    line = '';
  };

  for (const byte of buffer) {
    const char = String.fromCharCode(byte);
    const isPrintable = byte >= 33 && byte <= 126 && byte !== 61;
    const encoded = isPrintable ? char : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;

    if (line.length + encoded.length > 73) {
      flush(true);
    }
    line += encoded;
  }
  flush(false);
  return lines.join('\r\n');
}

/** Lectura sincrónica del logo (envuelto para no arrastrar `fs` a los tests). */
