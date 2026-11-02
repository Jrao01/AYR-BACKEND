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

describe('GET /api/locations (público)', () => {
  it('type=office devuelve las oficinas con coords [lat, lng] e imagen URL', async () => {
    const res = await request(app).get('/api/locations?type=office');
    expect(res.status).toBe(200);

    const offices = res.body.data as Array<{
      id: string;
      slug: string;
      type: string;
      coords: [number, number];
      image: string | null;
      address: string | null;
      phone: string | null;
    }>;

    expect(offices.length).toBeGreaterThanOrEqual(3);
    for (const office of offices) {
      expect(office.type).toBe('office');
      expect(Array.isArray(office.coords)).toBe(true);
      expect(office.coords).toHaveLength(2);
      expect(typeof office.coords[0]).toBe('number');
      expect(typeof office.coords[1]).toBe('number');
      expect(typeof office.image).toBe('string');
      expect(office.image).toMatch(/^\/uploads\/imgs\//);
      expect(office.address).toBeTruthy();
      expect(office.phone).toBeTruthy();
      expect(office.id).toBe(office.slug); // compatibilidad con data/offices.ts
    }

    const miranda = offices.find((o) => o.slug === 'miranda');
    expect(miranda).toBeTruthy();
    expect(miranda!.coords[0]).toBeCloseTo(10.148869, 6);
    expect(miranda!.coords[1]).toBeCloseTo(-68.395657, 6);
  });

  it('type=future devuelve el marcador de Nirgua sin imagen ni dirección', async () => {
    const res = await request(app).get('/api/locations?type=future');
    expect(res.status).toBe(200);

    const futures = res.body.data as Array<{
      slug: string;
      type: string;
      municipality: string;
      state: string;
      image: string | null;
      address: string | null;
    }>;

    expect(futures.length).toBeGreaterThanOrEqual(1);
    expect(futures.every((f) => f.type === 'future')).toBe(true);

    const nirgua = futures.find((f) => f.slug === 'nirgua');
    expect(nirgua).toBeTruthy();
    expect(nirgua!.municipality).toBe('Nirgua');
    expect(nirgua!.state).toBe('Yaracuy');
    expect(nirgua!.image).toBeNull();
    expect(nirgua!.address).toBeNull();
  });

  it('sin type devuelve oficinas y futuras', async () => {
    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(200);
    const types = new Set(res.body.data.map((l: { type: string }) => l.type));
    expect(types.has('office')).toBe(true);
    expect(types.has('future')).toBe(true);
  });

  it('rechaza un type inválido (400)', async () => {
    const res = await request(app).get('/api/locations?type=tienda');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST/PATCH/DELETE /api/admin/locations', () => {
  it('exige autenticación (401)', async () => {
    expect((await request(app).get('/api/admin/locations')).status).toBe(401);
    expect((await request(app).post('/api/admin/locations').send({})).status).toBe(401);
  });

  it('valida reglas de negocio (400)', async () => {
    const t = await auth();

    // Oficina sin address
    const officeNoAddress = await request(app)
      .post('/api/admin/locations')
      .set(bearer(t))
      .send({
        slug: uniqueKey('oficina'),
        type: 'office',
        municipality: 'Puerto Cabello',
        phone: '0412-0000000',
        lat: 10.47,
        lng: -68.0,
      });
    expect(officeNoAddress.status).toBe(400);

    // Latitud fuera de rango
    const badLat = await request(app)
      .post('/api/admin/locations')
      .set(bearer(t))
      .send({
        slug: uniqueKey('futura'),
        type: 'future',
        municipality: 'Guigüe',
        lat: 95,
        lng: -68,
      });
    expect(badLat.status).toBe(400);
  });

  it('ciclo completo: crear futura, verse en el público, mover coordenadas y soft-delete', async () => {
    const t = await auth();
    const slug = uniqueKey('futura');

    const create = await request(app)
      .post('/api/admin/locations')
      .set(bearer(t))
      .send({
        slug,
        type: 'future',
        municipality: 'Guigüe',
        state: 'Carabobo',
        lat: 10.08,
        lng: -68.3,
        order: 999,
      });
    expect(create.status).toBe(201);
    expect(create.body.data.id).toBe(slug);
    expect(create.body.data.type).toBe('future');
    expect(create.body.data.coords).toEqual([10.08, -68.3]);

    const publicList = await request(app).get('/api/locations?type=future');
    expect(publicList.body.data.some((l: { slug: string }) => l.slug === slug)).toBe(true);

    // Mover el pino (PATCH por slug)
    const patch = await request(app)
      .patch(`/api/admin/locations/${slug}`)
      .set(bearer(t))
      .send({ lat: 10.25, lng: -68.12 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.coords).toEqual([10.25, -68.12]);

    const afterPatch = await request(app).get('/api/locations?type=future');
    const moved = afterPatch.body.data.find((l: { slug: string }) => l.slug === slug);
    expect(moved.coords).toEqual([10.25, -68.12]);

    const del = await request(app).delete(`/api/admin/locations/${slug}`).set(bearer(t));
    expect(del.status).toBe(204);

    const afterDelete = await request(app).get('/api/locations?type=future');
    expect(afterDelete.body.data.some((l: { slug: string }) => l.slug === slug)).toBe(false);
  });

  it('impide convertir una futura en oficina sin dirección ni teléfono (400)', async () => {
    const t = await auth();
    const slug = uniqueKey('futura');

    const create = await request(app)
      .post('/api/admin/locations')
      .set(bearer(t))
      .send({
        slug,
        type: 'future',
        municipality: 'Guigüe',
        lat: 10.08,
        lng: -68.3,
        order: 999,
      });
    expect(create.status).toBe(201);

    // Cambiar a oficina sin address/phone debe rechazarse (la fila final quedaría
    // sin teléfono y el frontend se rompería: phone.slice/whatsappUrl sobre null).
    const badSwap = await request(app)
      .patch(`/api/admin/locations/${slug}`)
      .set(bearer(t))
      .send({ type: 'office' });
    expect(badSwap.status).toBe(400);
    expect(badSwap.body.error.code).toBe('OFICINA_INCOMPLETA');

    // Con dirección y teléfono sí se permite.
    const goodSwap = await request(app)
      .patch(`/api/admin/locations/${slug}`)
      .set(bearer(t))
      .send({ type: 'office', address: 'Calle Test, Local 1', phone: '0412-1111111' });
    expect(goodSwap.status).toBe(200);
    expect(goodSwap.body.data.type).toBe('office');
    expect(goodSwap.body.data.phone).toBe('0412-1111111');

    // Editar otros campos de la oficina no exige reenviar phone/address.
    const minorEdit = await request(app)
      .patch(`/api/admin/locations/${slug}`)
      .set(bearer(t))
      .send({ reference: 'Frente a la plaza' });
    expect(minorEdit.status).toBe(200);

    await request(app).delete(`/api/admin/locations/${slug}`).set(bearer(t));
  });

  it('devuelve 404 al editar o borrar una ubicación inexistente', async () => {
    const t = await auth();
    const patch = await request(app)
      .patch('/api/admin/locations/no-existe')
      .set(bearer(t))
      .send({ lat: 10 });
    expect(patch.status).toBe(404);

    const del = await request(app).delete('/api/admin/locations/no-existe').set(bearer(t));
    expect(del.status).toBe(404);
  });
});
