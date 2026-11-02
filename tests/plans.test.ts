import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { bearer, login, uniqueKey } from './helpers.ts';

const app = createApp();

let token = '';
async function auth() {
  token ||= await login(app);
  return token;
}

describe('GET /api/plans (público)', () => {
  it('devuelve los planes activos sin token, en orden y con el formato del frontend', async () => {
    const res = await request(app).get('/api/plans');
    expect(res.status).toBe(200);

    const plans = res.body.data as Array<{
      id: string;
      slug: string;
      group: string;
      price: number;
      speed: number;
      order: number;
    }>;

    // El seed trae 7; otros tests pueden dejar planes inactivos, nunca activos de más.
    expect(plans.length).toBeGreaterThanOrEqual(6);

    const hogar1 = plans.find((p) => p.slug === 'hogar-1');
    expect(hogar1).toBeTruthy();
    expect(hogar1!.id).toBe('hogar-1'); // id = slug: compatibilidad con data/plans.ts
    expect(hogar1!.group).toBe('hogar');
    expect(hogar1!.price).toBe(25);
    expect(hogar1!.speed).toBe(150);

    const groups = new Set(plans.map((p) => p.group));
    expect([...groups].sort()).toEqual(['avanzado', 'empresarial', 'hogar']);
    expect(plans.every((p) => typeof p.price === 'number')).toBe(true);

    const orders = plans.map((p) => p.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe('POST/PATCH/DELETE /api/admin/plans', () => {
  it('exige autenticación (401)', async () => {
    expect((await request(app).get('/api/admin/plans')).status).toBe(401);
    expect((await request(app).post('/api/admin/plans').send({})).status).toBe(401);
    expect((await request(app).patch('/api/admin/plans/hogar-1').send({ price: 1 })).status).toBe(401);
    expect((await request(app).delete('/api/admin/plans/hogar-1')).status).toBe(401);
  });

  it('rechaza payloads inválidos (400)', async () => {
    const t = await auth();
    const res = await request(app).post('/api/admin/plans').set(bearer(t)).send({
      slug: 'plan-invalido',
      name: 'Plan inválido',
      speed: -1,
      price: -5,
      segment: 'Hogar',
      use: 'pruebas',
      devices: '1',
      group: 'no-existe',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ciclo completo: crear, publicarse, editar precio y soft-delete', async () => {
    const t = await auth();
    const slug = uniqueKey('plan');

    const create = await request(app)
      .post('/api/admin/plans')
      .set(bearer(t))
      .send({
        slug,
        name: 'Plan Prueba',
        speed: 123,
        price: 9.5,
        segment: 'Hogar',
        use: 'Pruebas E2E',
        devices: '1 dispositivo',
        group: 'hogar',
        order: 999,
      });
    expect(create.status).toBe(201);
    expect(create.body.data.id).toBe(slug);
    expect(create.body.data.price).toBe(9.5);
    expect(create.body.data.active).toBe(true);

    // Aparece en el listado público
    const publicList = await request(app).get('/api/plans');
    expect(publicList.body.data.some((p: { slug: string }) => p.slug === slug)).toBe(true);

    // PATCH por slug
    const patch = await request(app)
      .patch(`/api/admin/plans/${slug}`)
      .set(bearer(t))
      .send({ price: 11 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.price).toBe(11);

    const publicAfterPatch = await request(app).get('/api/plans');
    const patched = publicAfterPatch.body.data.find((p: { slug: string }) => p.slug === slug);
    expect(patched.price).toBe(11);

    // Soft-delete: sale del público, sigue en admin como inactivo
    const del = await request(app).delete(`/api/admin/plans/${slug}`).set(bearer(t));
    expect(del.status).toBe(204);

    const afterPublic = await request(app).get('/api/plans');
    expect(afterPublic.body.data.some((p: { slug: string }) => p.slug === slug)).toBe(false);

    const adminList = await request(app).get('/api/admin/plans').set(bearer(t));
    const row = adminList.body.data.find((p: { slug: string }) => p.slug === slug);
    expect(row).toBeTruthy();
    expect(row.active).toBe(false);
  });

  it('devuelve 404 al editar o borrar un plan inexistente', async () => {
    const t = await auth();
    const patch = await request(app)
      .patch('/api/admin/plans/no-existe')
      .set(bearer(t))
      .send({ price: 1 });
    expect(patch.status).toBe(404);

    const del = await request(app).delete('/api/admin/plans/no-existe').set(bearer(t));
    expect(del.status).toBe(404);
  });
});
