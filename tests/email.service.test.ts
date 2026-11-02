import { describe, expect, it } from 'vitest';
import { GMAIL_CLIP_BYTES, sendOtpEmail } from '../utils/email/email.service.ts';

describe('sendOtpEmail (validaciones previas a la API)', () => {
  it('rechaza el envío si el HTML supera el límite de recorte de Gmail', async () => {
    // Un nombre enorme infla el HTML por encima de 102 KB sin tocar la red.
    const result = await sendOtpEmail({
      to: 'destino@example.com',
      apiKey: 're_test_key',
      code: '48291357',
      expiresInMinutes: 10,
      recipientName: 'a'.repeat(GMAIL_CLIP_BYTES),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('message_too_large');
      expect(result.error).toContain('102 KB');
    }
  });

  it('rechaza códigos OTP con formato inválido antes de llamar a la API', async () => {
    const result = await sendOtpEmail({
      to: 'destino@example.com',
      apiKey: 're_test_key',
      code: '123',
      expiresInMinutes: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('validation_error');
    }
  });
});
