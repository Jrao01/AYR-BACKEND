import { describe, expect, it } from 'vitest';
import { buildOtpEml, encodeHeaderValue, GMAIL_CLIP_BYTES, toBase64Lines, toQuotedPrintable } from '../utils/email/eml.ts';

const base = { code: '48291357', expiresInMinutes: 10, to: 'destino@example.com' };

describe('encodeHeaderValue', () => {
  it('deja intactos los valores ASCII', () => {
    expect(encodeHeaderValue('Codigo de verificacion - AyrNetworx')).toBe('Codigo de verificacion - AyrNetworx');
  });

  it('codifica los valores con acentos según RFC 2047', () => {
    const encoded = encodeHeaderValue('Código de verificación - AyrNetworx');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    expect(encoded).not.toContain('ó');
  });

  it('el valor decodificado conserva el texto original', () => {
    const encoded = encodeHeaderValue('Código de verificación');
    const decoded = encoded
      .split(' ')
      .map((chunk) => Buffer.from(chunk.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8'))
      .join('');
    expect(decoded).toBe('Código de verificación');
  });
});

describe('toQuotedPrintable', () => {
  it('codifica los caracteres no imprimibles', () => {
    expect(toQuotedPrintable('a=b')).toContain('=3D');
  });

  it('respeta el límite de longitud de línea', () => {
    const encoded = toQuotedPrintable('á'.repeat(200));
    for (const line of encoded.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });
});

describe('toBase64Lines', () => {
  it('parte el base64 en líneas de 76 caracteres', () => {
    const lines = toBase64Lines(Buffer.alloc(300, 1)).split('\r\n');
    for (const line of lines.slice(0, -1)) {
      expect(line.length).toBe(76);
    }
  });
});

describe('buildOtpEml', () => {
  it('genera un mensaje multipart/alternative con el texto y el HTML', () => {
    const { raw } = buildOtpEml(base);
    expect(raw).toContain('Content-Type: multipart/alternative;');
    expect(raw).toContain('Content-Type: text/plain; charset=utf-8');
    expect(raw).toContain('Content-Type: text/html; charset=utf-8');
    expect(raw).toContain('Content-Type: multipart/related;');
  });

  it('incluye el logo inline con su Content-ID', () => {
    const { raw } = buildOtpEml(base);
    expect(raw).toContain('Content-ID: <ayr-logo>');
    expect(raw).toContain('Content-Disposition: inline; filename="ayr-logo-blanco.png"');
  });

  it('omite el logo cuando inlineLogo es false', () => {
    const { raw } = buildOtpEml({ ...base, inlineLogo: false });
    expect(raw).not.toContain('Content-ID: <ayr-logo>');
  });

  it('incluye los encabezados de remitente, destino y asunto', () => {
    const { raw, messageId } = buildOtpEml(base);
    expect(raw).toContain('From: AyrNetworx <admin@ayrnetworxv.ve>');
    expect(raw).toContain('To: destino@example.com');
    expect(raw).toContain('Reply-To: soporte@ayrnetworxv.ve');
    expect(raw).toContain(`Message-ID: ${messageId}`);
  });

  it('usa terminadores CRLF en todas las líneas', () => {
    const { raw } = buildOtpEml(base);
    const bareNewlines = raw.split('\r\n').filter((line) => line.includes('\n'));
    expect(bareNewlines).toHaveLength(0);
  });

  it('el mensaje completo queda por debajo del límite de recorte de Gmail', () => {
    const { bytes } = buildOtpEml(base);
    expect(bytes).toBeLessThan(GMAIL_CLIP_BYTES);
  });

  it('el texto plano incluye el código en claro', () => {
    const { raw } = buildOtpEml(base);
    const textPart = raw.split('Content-Type: text/plain')[1]?.split('--')[0] ?? '';
    expect(textPart).toContain('48291357');
  });
});
