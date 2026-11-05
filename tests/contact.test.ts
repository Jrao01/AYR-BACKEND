import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/lib/prisma.ts';

const app = createApp({ globalRateMax: 1000 });

// JPEG mínimo: solo importa que el tipo sea image/jpeg para Multer.
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);

function validForm(email = `contacto-${Date.now()}@example.invalid`) {
  return request(app)
    .post('/api/contact')
    .field('firstname', 'Prueba')
    .field('lastname', 'Contacto')
    .field('address', 'Calle 1, casa 2')
    .field('phone_number', '04141234567')
    .field('email', email)
    .field('location', 'Centro')
    .field('city', 'Valencia')
    .field('commentaries', 'Solicitud de prueba automatizada');
}

describe('POST /api/contact', () => {
  it('guarda el lead y responde 202 sin esperar a Wisphub', async () => {
    const email = `contacto-${Date.now()}@example.invalid`;
    const res = await validForm(email)
      .attach('front_dni_proof', jpeg, { filename: 'front.jpg', contentType: 'image/jpeg' })
      .attach('back_dni_proof', jpeg, { filename: 'back.jpg', contentType: 'image/jpeg' })
      .attach('proof_of_address', jpeg, { filename: 'proof.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(202);
    expect(res.body.data.id).toBeTruthy();

    const row = await prisma.contactSubmission.findUnique({ where: { id: res.body.data.id } });
    expect(row).not.toBeNull();
    expect(row?.email).toBe(email);
    // Wisphub se envía en segundo plano: la respuesta no depende de él.
    expect(['pending', 'sent_to_wisphub']).toContain(row?.status);

    await prisma.contactSubmission.delete({ where: { id: res.body.data.id } });
  });

  it('exige las tres fotos', async () => {
    const res = await validForm();
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ARCHIVOS_REQUERIDOS');
  });

  it('rechaza adjuntos que no son imágenes', async () => {
    const res = await validForm()
      .attach('front_dni_proof', Buffer.from('no soy una imagen'), {
        filename: 'nota.txt',
        contentType: 'text/plain',
      })
      .attach('back_dni_proof', jpeg, { filename: 'back.jpg', contentType: 'image/jpeg' })
      .attach('proof_of_address', jpeg, { filename: 'proof.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ARCHIVO_INVALIDO');
  });
});
