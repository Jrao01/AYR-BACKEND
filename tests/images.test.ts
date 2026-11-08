import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { env } from '../src/config/env.ts';
import { bearer, login, uniqueKey } from './helpers.ts';

const app = createApp();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMGS_DIR = path.join(env.UPLOAD_DIR, 'imgs');
const REAL_PNG = path.join(ROOT, '..', 'web', 'public', 'imgs', 'final-conatel.png');

let token = '';
async function auth() {
  token ||= await login(app);
  return token;
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).length;
}

describe('POST /api/admin/images/upload', () => {
  it('exige autenticación (401)', async () => {
    const res = await request(app).post('/api/admin/images/upload?folder=imgs').attach(
      'file',
      Buffer.from('x'),
      { filename: 'x.png', contentType: 'image/png' },
    );
    expect(res.status).toBe(401);
  });

  it('rechaza extensiones no permitidas (400)', async () => {
    const t = await auth();
    const res = await request(app)
      .post('/api/admin/images/upload?folder=imgs')
      .set(bearer(t))
      .attach('file', Buffer.from('no es imagen'), {
        filename: 'nota.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TIPO_NO_PERMITIDO');
  });

  it('rechaza contenido que no coincide con la extensión y no deja huérfanos (400)', async () => {
    const t = await auth();
    const before = countFiles(IMGS_DIR);

    const res = await request(app)
      .post('/api/admin/images/upload?folder=imgs')
      .set(bearer(t))
      .attach('file', Buffer.from('esto no es un png de verdad'), {
        filename: 'falso.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TIPO_INVALIDO');
    expect(countFiles(IMGS_DIR)).toBe(before);
  });

  it('rechaza archivos sin campo file (400)', async () => {
    const t = await auth();
    const res = await request(app)
      .post('/api/admin/images/upload?folder=imgs')
      .set(bearer(t))
      .field('key', 'sin-archivo');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ARCHIVO_REQUERIDO');
  });

  it('rechaza carpeta inválida (400)', async () => {
    const t = await auth();
    const res = await request(app)
      .post('/api/admin/images/upload?folder=hackeo')
      .set(bearer(t))
      .attach('file', fs.readFileSync(REAL_PNG), {
        filename: 'algo.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FOLDER_INVALIDO');
  });

  it('rechaza archivos que superan el límite (400)', async () => {
    const t = await auth();
    const big = Buffer.alloc(Math.round(1.2 * 1024 * 1024), 7);
    const res = await request(app)
      .post('/api/admin/images/upload?folder=imgs')
      .set(bearer(t))
      .attach('file', big, { filename: 'grande.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UPLOAD_ERROR');
  });

  it('rechaza una clave duplicada (409)', async () => {
    const t = await auth();
    const key = uniqueKey('dup');
    const png = fs.readFileSync(REAL_PNG);

    const first = await request(app)
      .post('/api/admin/images/upload?folder=imgs')
      .set(bearer(t))
      .attach('file', png, { filename: 'uno.png', contentType: 'image/png' })
      .field('key', key);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/admin/images/upload?folder=imgs')
      .set(bearer(t))
      .attach('file', png, { filename: 'dos.png', contentType: 'image/png' })
      .field('key', key);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('KEY_DUPLICADA');

    await request(app)
      .delete(`/api/admin/images/${first.body.data.id}`)
      .set(bearer(t));
  });
});

describe('ciclo completo de una imagen', () => {
  it('sube, se sirve públicamente, se lista, se edita y se borra', async () => {
    const t = await auth();
    const key = uniqueKey('ciclo');

    const upload = await request(app)
      .post('/api/admin/images/upload?folder=imgs')
      .set(bearer(t))
      .attach('file', fs.readFileSync(REAL_PNG), {
        filename: 'final-conatel.png',
        contentType: 'image/png',
      })
      .field('key', key)
      .field('alt', 'Sello CONATEL');

    expect(upload.status).toBe(201);
    const created = upload.body.data;
    expect(created.key).toBe(key);
    expect(created.alt).toBe('Sello CONATEL');
    expect(created.url).toMatch(/^\/uploads\/imgs\/.+\.png$/);

    // Servida públicamente (sin token) y con cache
    const publicGet = await request(app).get(created.url);
    expect(publicGet.status).toBe(200);
    expect(publicGet.headers['content-type']).toContain('image/png');
    expect(publicGet.headers['cache-control']).toContain('max-age=31536000');

    // Listado admin la incluye
    const list = await request(app).get('/api/admin/images').set(bearer(t));
    expect(list.status).toBe(200);
    expect(list.body.data.some((img: { key: string }) => img.key === key)).toBe(true);

    // Edición
    const patch = await request(app)
      .patch(`/api/admin/images/${created.id}`)
      .set(bearer(t))
      .send({ alt: 'Sello CONATEL (editado)' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.alt).toBe('Sello CONATEL (editado)');

    // Borrado
    const del = await request(app)
      .delete(`/api/admin/images/${created.id}`)
      .set(bearer(t));
    expect(del.status).toBe(204);

    const afterDelete = await request(app).get(created.url);
    expect(afterDelete.status).toBe(404);

    const listAfter = await request(app).get('/api/admin/images').set(bearer(t));
    expect(listAfter.body.data.some((img: { key: string }) => img.key === key)).toBe(false);
  });

  it('devuelve 404 al borrar una imagen inexistente', async () => {
    const t = await auth();
    const res = await request(app)
      .delete('/api/admin/images/no-existe')
      .set(bearer(t));
    expect(res.status).toBe(404);
  });
});

describe('foto de una sede', () => {
  it('sube, reemplaza y quita la foto; el público la refleja', async () => {
    const t = await auth();
    const slug = uniqueKey('sede');

    const create = await request(app)
      .post('/api/admin/locations')
      .set(bearer(t))
      .send({
        slug,
        type: 'future',
        municipality: 'Sede de prueba',
        state: 'Carabobo',
        lat: 10.1,
        lng: -68.1,
        order: 999,
      });
    expect(create.status).toBe(201);

    const png = fs.readFileSync(REAL_PNG);

    // Subida: crea la clave `sede-<slug>` y vincula la ubicación.
    const upload = await request(app)
      .put(`/api/admin/images/locations/${slug}`)
      .set(bearer(t))
      .attach('file', png, { filename: 'foto.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    expect(upload.body.data.key).toBe(`sede-${slug}`);
    expect(upload.body.data.url).toMatch(/^\/uploads\/imgs\/.+\.png$/);

    const publicAfterUpload = await request(app).get('/api/locations?type=future');
    const linked = publicAfterUpload.body.data.find((loc: { slug: string }) => loc.slug === slug);
    expect(linked.image).toBe(upload.body.data.url);

    // Reemplazo: la misma clave, un archivo nuevo.
    const replace = await request(app)
      .put(`/api/admin/images/locations/${slug}`)
      .set(bearer(t))
      .attach('file', png, { filename: 'foto-2.png', contentType: 'image/png' });
    expect(replace.status).toBe(201);
    expect(replace.body.data.key).toBe(`sede-${slug}`);
    expect(replace.body.data.url).not.toBe(upload.body.data.url);

    // Quitar: la ubicación queda sin foto y el archivo se elimina.
    const remove = await request(app)
      .delete(`/api/admin/images/locations/${slug}/image`)
      .set(bearer(t));
    expect(remove.status).toBe(204);

    const publicAfterRemove = await request(app).get('/api/locations?type=future');
    const unlinked = publicAfterRemove.body.data.find((loc: { slug: string }) => loc.slug === slug);
    expect(unlinked.image).toBeNull();

    const oldFile = await request(app).get(replace.body.data.url);
    expect(oldFile.status).toBe(404);

    await request(app).delete(`/api/admin/locations/${slug}`).set(bearer(t));
  });
});
