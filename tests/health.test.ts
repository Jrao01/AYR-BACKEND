import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';

describe('GET /api/health', () => {
  it('responde 200 con la base de datos arriba', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(typeof res.body.uptime).toBe('number');
  });

  it('devuelve el id de petición en la cabecera x-request-id', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('rutas inexistentes', () => {
  it('responde 404 con error envuelto', async () => {
    const res = await request(createApp()).get('/api/que-es-esto');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('CORS', () => {
  it('permite el origen del frontend configurado', async () => {
    const res = await request(createApp())
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('no publica cabecera CORS para orígenes ajenos', async () => {
    const res = await request(createApp())
      .get('/api/plans')
      .set('Origin', 'http://malicioso.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
