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
