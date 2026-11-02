import { describe, expect, it } from 'vitest';
import { COMPANY } from '../utils/email/brand.ts';
import { GMAIL_CLIP_BYTES } from '../utils/email/email.service.ts';
import { normalizeOtp, renderOtpHtml, renderOtpText } from '../utils/email/otp.template.ts';

const base = { code: '48291357', expiresInMinutes: 10 };

describe('normalizeOtp', () => {
  it('acepta 8 dígitos', () => {
    expect(normalizeOtp('48291357')).toBe('48291357');
  });

  it('descarta separadores comunes (espacios y guiones)', () => {
    expect(normalizeOtp('4829 1357')).toBe('48291357');
    expect(normalizeOtp('4829-1357')).toBe('48291357');
  });

  it('rechaza códigos que no tienen 8 dígitos', () => {
    expect(() => normalizeOtp('123456')).toThrow(/8 dígitos/);
    expect(() => normalizeOtp('123456789')).toThrow(/8 dígitos/);
    expect(() => normalizeOtp('abcdefgh')).toThrow(/8 dígitos/);
  });
});

describe('renderOtpHtml', () => {
  it('incluye el código, el logo inline y la vigencia', () => {
    const html = renderOtpHtml(base);
    expect(html).toContain('48291357');
    expect(html).toContain('src="cid:ayr-logo"');
    expect(html).toContain('Expira en 10 minutos');
  });

  it('genera una versión en texto plano con el código', () => {
    const text = renderOtpText(base);
    expect(text).toContain('48291357');
    expect(text).toContain('expira en 10 minutos');
  });

  it('escapa el contenido dinámico', () => {
    const html = renderOtpHtml({ ...base, recipientName: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('omite el botón cuando no hay acción configurada', () => {
    expect(renderOtpHtml(base)).not.toContain('v:roundrect');
  });

  it('incluye el botón cuando hay URL y etiqueta', () => {
    const html = renderOtpHtml({ ...base, actionUrl: 'https://ayrnetworxv.ve', actionLabel: 'Continuar' });
    expect(html).toContain('v:roundrect');
    expect(html).toContain('Continuar');
  });

  it('no incluye eslogan ni texto promocional (correo transaccional neutro)', () => {
    const html = renderOtpHtml(base);
    expect(html).not.toContain(COMPANY.slogan);
    expect(html).not.toContain('mejor opción');
  });

  it('se mantiene muy por debajo del límite de recorte de Gmail (102 KB)', () => {
    const bytes = Buffer.byteLength(renderOtpHtml(base), 'utf8');
    expect(bytes).toBeLessThan(GMAIL_CLIP_BYTES / 2);
  });
});
