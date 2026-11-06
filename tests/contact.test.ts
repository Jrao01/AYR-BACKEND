import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { env } from '../src/config/env.ts';
import { prisma } from '../src/lib/prisma.ts';
import { CONTACT_UPLOAD_DIR } from '../src/modules/contact/contact.storage.ts';
import { bearer, login, uniqueKey } from './helpers.ts';

const app = createApp({ globalRateMax: 1000 });

// JPEG mínimo: solo importa que el tipo sea image/jpeg para Multer.
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);

const createdIds = new Set<string>();
const createdFiles = new Set<string>();

let token = '';
async function auth(): Promise<string> {
  token ||= await login(app);
  return token;
}

function storedPath(fileName: string): string {
  return path.join(CONTACT_UPLOAD_DIR, fileName);
}

function writeJpeg(): string {
  const fileName = `${uniqueKey('adjunto')}.jpg`;
  fs.writeFileSync(storedPath(fileName), jpeg);
  createdFiles.add(fileName);
  return fileName;
}

async function createSubmission(
  options: { attachments?: boolean; status?: string; sending?: boolean } = {},
): Promise<{ id: string; front: string | null; back: string | null; proof: string | null }> {
  const withFiles = options.attachments ?? true;
  const front = withFiles ? writeJpeg() : null;
  const back = withFiles ? writeJpeg() : null;
  const proof = withFiles ? writeJpeg() : null;

  const row = await prisma.contactSubmission.create({
    data: {
      name: 'Cliente de Prueba',
      email: `admin-${uniqueKey()}@example.invalid`,
      phone: '04141234567',
      municipality: 'Valencia',
      message: 'Solicitud creada por las pruebas automatizadas',
      address: 'Calle 1, casa 2',
      location: 'Centro',
      frontDniProof: front,
      backDniProof: back,
      proofOfAddress: proof,
      status: options.status ?? 'pending',
      wisphubSendingAt: options.sending ? new Date() : null,
    },
  });
  createdIds.add(row.id);
  return { id: row.id, front, back, proof };
}

afterAll(async () => {
  if (createdIds.size > 0) {
    await prisma.contactSubmission.deleteMany({ where: { id: { in: [...createdIds] } } });
  }
  for (const fileName of createdFiles) {
    fs.rmSync(storedPath(fileName), { force: true });
  }
});

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
  it('guarda el lead, sus adjuntos y responde 202 sin esperar a Wisphub', async () => {
    const email = `contacto-${Date.now()}@example.invalid`;
    const res = await validForm(email)
      .attach('front_dni_proof', jpeg, { filename: 'front.jpg', contentType: 'image/jpeg' })
      .attach('back_dni_proof', jpeg, { filename: 'back.jpg', contentType: 'image/jpeg' })
      .attach('proof_of_address', jpeg, { filename: 'proof.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(202);
    expect(res.body.data.id).toBeTruthy();

    const id = res.body.data.id as string;
    createdIds.add(id);

    const row = await prisma.contactSubmission.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row?.email).toBe(email);
    expect(row?.frontDniProof).toBeTruthy();
    expect(row?.backDniProof).toBeTruthy();
    expect(row?.proofOfAddress).toBeTruthy();
    // Wisphub se envía en segundo plano: la respuesta no depende de él.
    expect(['pending', 'sent_to_wisphub']).toContain(row?.status);

    // Los adjuntos ya son permanentes: no se borran al fallar el envío.
    for (const fileName of [row?.frontDniProof, row?.backDniProof, row?.proofOfAddress]) {
      expect(fileName).toBeTruthy();
      createdFiles.add(fileName as string);
      expect(fs.existsSync(storedPath(fileName as string))).toBe(true);
    }
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

describe('GET /api/admin/contact-submissions/:id/attachments/:kind', () => {
  it('exige autenticación (401)', async () => {
    const submission = await createSubmission();
    const res = await request(app).get(
      `/api/admin/contact-submissions/${submission.id}/attachments/front`,
    );
    expect(res.status).toBe(401);
  });

  it('sirve la imagen con token (200)', async () => {
    const submission = await createSubmission();
    const t = await auth();
    const res = await request(app)
      .get(`/api/admin/contact-submissions/${submission.id}/attachments/front`)
      .set(bearer(t));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('devuelve 404 cuando el adjunto no existe', async () => {
    const submission = await createSubmission({ attachments: false });
    const t = await auth();
    const res = await request(app)
      .get(`/api/admin/contact-submissions/${submission.id}/attachments/front`)
      .set(bearer(t));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ADJUNTO_NO_ENCONTRADO');
  });

  it('rechaza un tipo de adjunto inválido (400)', async () => {
    const submission = await createSubmission();
    const t = await auth();
    const res = await request(app)
      .get(`/api/admin/contact-submissions/${submission.id}/attachments/otro`)
      .set(bearer(t));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ADJUNTO_INVALIDO');
  });
});

describe('PATCH /api/admin/contact-submissions/:id', () => {
  it('actualiza los datos que registró el cliente', async () => {
    const submission = await createSubmission();
    const t = await auth();

    const res = await request(app)
      .patch(`/api/admin/contact-submissions/${submission.id}`)
      .set(bearer(t))
      .field('name', 'Nombre Editado')
      .field('email', 'editado@example.invalid')
      .field('address', 'Nueva dirección')
      .field('location', 'Nueva localidad')
      .field('postalCode', '2001')
      .field('phone', '');

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Nombre Editado');
    expect(res.body.data.email).toBe('editado@example.invalid');
    expect(res.body.data.address).toBe('Nueva dirección');
    expect(res.body.data.location).toBe('Nueva localidad');
    expect(res.body.data.postalCode).toBe('2001');
    expect(res.body.data.phone).toBeNull();
  });

  it('reemplaza un adjunto y borra el anterior', async () => {
    const submission = await createSubmission();
    const t = await auth();
    const previous = submission.front as string;

    const res = await request(app)
      .patch(`/api/admin/contact-submissions/${submission.id}`)
      .set(bearer(t))
      .attach('front_dni_proof', jpeg, { filename: 'nuevo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.data.attachments.front).toBe(true);

    const row = await prisma.contactSubmission.findUnique({ where: { id: submission.id } });
    expect(row?.frontDniProof).toBeTruthy();
    expect(row?.frontDniProof).not.toBe(previous);
    createdFiles.add(row?.frontDniProof as string);
    expect(fs.existsSync(storedPath(previous))).toBe(false);
  });

  it('bloquea la edición de una solicitud ya enviada (409)', async () => {
    const submission = await createSubmission({ status: 'sent_to_wisphub' });
    const t = await auth();

    const res = await request(app)
      .patch(`/api/admin/contact-submissions/${submission.id}`)
      .set(bearer(t))
      .field('name', 'No debería cambiar');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_SENT');
  });
});

describe('POST /api/admin/contact-submissions/:id/migrate', () => {
  it('exige autenticación (401)', async () => {
    const submission = await createSubmission();
    const res = await request(app).post(
      `/api/admin/contact-submissions/${submission.id}/migrate`,
    );
    expect(res.status).toBe(401);
  });

  it('bloquea el envío si faltan adjuntos (400)', async () => {
    const submission = await createSubmission({ attachments: false });
    const t = await auth();

    const res = await request(app)
      .post(`/api/admin/contact-submissions/${submission.id}/migrate`)
      .set(bearer(t));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_ATTACHMENTS');
    expect(res.body.error.details.missing).toHaveLength(3);
  });

  it('no duplica un envío en curso (409)', async () => {
    const submission = await createSubmission({ sending: true });
    const t = await auth();

    const res = await request(app)
      .post(`/api/admin/contact-submissions/${submission.id}/migrate`)
      .set(bearer(t));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ENVIO_EN_CURSO');
  });

  it('no reenvía una solicitud ya enviada (409)', async () => {
    const submission = await createSubmission({ status: 'sent_to_wisphub' });
    const t = await auth();

    const res = await request(app)
      .post(`/api/admin/contact-submissions/${submission.id}/migrate`)
      .set(bearer(t));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_SENT');
  });

  it('envía usando los datos y adjuntos guardados', async () => {
    const submission = await createSubmission();
    const t = await auth();

    const originalKey = env.WISPHUB_API_KEY;
    env.WISPHUB_API_KEY = 'clave-de-prueba';
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const res = await request(app)
        .post(`/api/admin/contact-submissions/${submission.id}/migrate`)
        .set(bearer(t));

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('sent_to_wisphub');
      expect(res.body.data.wisphubSentAt).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const row = await prisma.contactSubmission.findUnique({ where: { id: submission.id } });
      expect(row?.status).toBe('sent_to_wisphub');
      expect(row?.wisphubSendingAt).toBeNull();
    } finally {
      env.WISPHUB_API_KEY = originalKey;
      vi.unstubAllGlobals();
    }
  });
});
