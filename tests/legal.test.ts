import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { bearer, login } from './helpers.ts';

const app = createApp();

let token = '';
async function auth() {
  token ||= await login(app);
  return token;
}

type DocDto = {
  slug: string;
  type: string;
  title: string;
  version: number;
  lastModifiedAt: string | null;
  sections: Array<{ id: string; title: string; paragraphs?: string[]; list?: string[]; note?: string }>;
};

async function getPublic(slug: string): Promise<DocDto> {
  const res = await request(app).get(`/api/legal/${slug}`);
  expect(res.status).toBe(200);
  return res.body.data as DocDto;
}

describe('GET /api/legal (público)', () => {
  it('lista los documentos publicados con sus fechas', async () => {
    const res = await request(app).get('/api/legal');
    expect(res.status).toBe(200);

    const docs = res.body.data as Array<{ slug: string; type: string; lastModifiedAt: string }>;
    expect(docs.length).toBe(2);
    const slugs = docs.map((d) => d.slug).sort();
    expect(slugs).toEqual(['privacidad', 'terminos']);
    for (const doc of docs) {
      expect(doc.lastModifiedAt).toBeTruthy();
      expect(new Date(doc.lastModifiedAt).toString()).not.toBe('Invalid Date');
    }
  });

  it('devuelve terminos con secciones ordenadas y sin arrays vacíos', async () => {
    const doc = await getPublic('terminos');
    expect(doc.type).toBe('terms');
    expect(doc.title).toBe('Términos y Condiciones');
    expect(doc.version).toBeGreaterThanOrEqual(1);
    expect(Number.isNaN(new Date(doc.lastModifiedAt!).getTime())).toBe(false);
    expect(doc.sections.length).toBeGreaterThan(5);
    expect(doc.sections[0]!.id).toBe('naturaleza-portal');

    for (const section of doc.sections) {
      // Prisma guarda [] para "sin contenido"; el DTO lo traduce a ausente.
      if (section.paragraphs) expect(section.paragraphs.length).toBeGreaterThan(0);
      if (section.list) expect(section.list.length).toBeGreaterThan(0);
      if (section.note) expect(section.note.length).toBeGreaterThan(0);
    }
  });

  it('devuelve 404 para un slug desconocido', async () => {
    const res = await request(app).get('/api/legal/no-existe');
    expect(res.status).toBe(404);
  });
});

describe('flujo borrador → publicar (regla de fechas)', () => {
  it('PUT no toca lastModifiedAt ni versión; publish las sella y crea revisión', async () => {
    const t = await auth();
    const before = await getPublic('terminos');

    // 1) Guardar borrador con una sección marcada
    const draftSections = [
      {
        id: 'naturaleza-portal',
        title: 'Naturaleza del portal (borrador)',
        paragraphs: ['Párrafo de prueba del borrador.'],
      },
      ...before.sections.slice(1).map((s) => ({
        id: s.id,
        title: s.title,
        ...(s.paragraphs ? { paragraphs: s.paragraphs } : {}),
        ...(s.list ? { list: s.list } : {}),
        ...(s.note ? { note: s.note } : {}),
      })),
    ];

    const put = await request(app)
      .put('/api/admin/legal/terminos')
      .set(bearer(t))
      .send({ sections: draftSections });
    expect(put.status).toBe(200);
    const draft = put.body.data as DocDto & { status: string; hasUnpublishedChanges: boolean };
    expect(draft.lastModifiedAt).toBe(before.lastModifiedAt); // sin cambio
    expect(draft.version).toBe(before.version); // sin cambio
    expect(draft.hasUnpublishedChanges).toBe(true); // hay cambios sin sellar

    // Las secciones son de copia única: el borrador guardado es el contenido vivo,
    // pero la fecha pública NO avanza hasta publicar.
    const publicAfterPut = await getPublic('terminos');
    expect(publicAfterPut.version).toBe(before.version);
    expect(publicAfterPut.lastModifiedAt).toBe(before.lastModifiedAt);
    expect(publicAfterPut.sections[0]!.title).toBe('Naturaleza del portal (borrador)');

    // 2) Publicar: sella versión + fecha y deja de estar "sucio"
    const publish = await request(app)
      .post('/api/admin/legal/terminos/publish')
      .set(bearer(t))
      .send({ summary: 'Prueba del flujo de publicación' });
    expect(publish.status).toBe(200);
    const published = publish.body.data as DocDto & { hasUnpublishedChanges: boolean };
    expect(published.version).toBe(before.version + 1);
    expect(published.hasUnpublishedChanges).toBe(false);
    expect(published.lastModifiedAt).not.toBe(before.lastModifiedAt);
    expect(new Date(published.lastModifiedAt!).getTime()).toBeGreaterThan(
      new Date(before.lastModifiedAt!).getTime(),
    );

    // 3) El público ve la fecha nueva
    const publicAfterPublish = await getPublic('terminos');
    expect(publicAfterPublish.version).toBe(before.version + 1);
    expect(publicAfterPublish.lastModifiedAt).toBe(published.lastModifiedAt);

    // 4) El historial creció con la revisión nueva
    const history = await request(app)
      .get('/api/admin/legal/terminos/history')
      .set(bearer(t));
    expect(history.status).toBe(200);
    const revisions = history.body.data as Array<{ version: number; changedBy: string | null; summary: string | null }>;
    expect(revisions.length).toBeGreaterThanOrEqual(1);
    expect(revisions[0]!.version).toBe(before.version + 1);
    expect(revisions[0]!.changedBy).toBeTruthy();
    expect(revisions[0]!.summary).toBe('Prueba del flujo de publicación');
  });

  it('exige autenticación en el admin (401)', async () => {
    expect((await request(app).get('/api/admin/legal/terminos')).status).toBe(401);
    expect((await request(app).put('/api/admin/legal/terminos').send({ sections: [] })).status).toBe(401);
    expect((await request(app).post('/api/admin/legal/terminos/publish')).status).toBe(401);
    expect((await request(app).get('/api/admin/legal/terminos/history')).status).toBe(401);
  });

  it('devuelve 404 en el admin para un slug desconocido', async () => {
    const t = await auth();
    expect((await request(app).get('/api/admin/legal/no-existe').set(bearer(t))).status).toBe(404);
    const put = await request(app)
      .put('/api/admin/legal/no-existe')
      .set(bearer(t))
      .send({ sections: [{ id: 'x', title: 'X', paragraphs: ['y'] }] });
    expect(put.status).toBe(404);
    expect((await request(app).post('/api/admin/legal/no-existe/publish').set(bearer(t))).status).toBe(404);
  });

  it('valida la estructura de las secciones (400)', async () => {
    const t = await auth();
    const res = await request(app)
      .put('/api/admin/legal/terminos')
      .set(bearer(t))
      .send({ sections: [{ id: 'No Kebab', title: '', paragraphs: [] }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
