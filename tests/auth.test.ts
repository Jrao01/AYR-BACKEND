import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { adminCredentials, bearer, login } from './helpers.ts';

const app = createApp();

describe('POST /api/auth/login', () => {
  it('rechaza credenciales inválidas con 401', async () => {
    const { email } = adminCredentials();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'esta-no-es' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('valida el body con zod (400)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'no-es-correo' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('acepta credenciales válidas y emite access + refresh cookie', async () => {
    const res = await request(app).post('/api/auth/login').send(adminCredentials());
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.expiresIn).toBeGreaterThan(0);
    expect(res.body.data.user.role).toBe('ADMIN');

    const rawCookie = (res.headers as Record<string, string | string[]>)['set-cookie'];
    const cookie = Array.isArray(rawCookie) ? rawCookie.join(';') : String(rawCookie ?? '');
    expect(cookie).toContain('ayr_rt=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('aplica rate limit a los intentos de login (429)', async () => {
    const app2 = createApp({ authRateMax: 3 });
    let saw429 = false;
    for (let i = 0; i < 10 && !saw429; i += 1) {
      const res = await request(app2)
        .post('/api/auth/login')
        .send({ email: `no-existe-${i}@test.dev`, password: 'lo-que Sea-1' });
      saw429 = res.status === 429;
    }
    expect(saw429).toBe(true);
  }, 30_000);
});

describe('GET /api/auth/me', () => {
  it('exige token (401)', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rechaza un token basura (401)', async () => {
    const res = await request(app).get('/api/auth/me').set(bearer('token-basura'));
    expect(res.status).toBe(401);
  });

  it('devuelve el perfil con token válido (200)', async () => {
    const token = await login(app);
    const res = await request(app).get('/api/auth/me').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(adminCredentials().email);
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });
});

describe('POST /api/auth/refresh y logout', () => {
  it('rota la sesión con la cookie y la invalida tras logout', async () => {
    const agent = request.agent(app);

    const loginRes = await agent.post('/api/auth/login').send(adminCredentials());
    expect(loginRes.status).toBe(200);

    const refreshRes = await agent.post('/api/auth/refresh');
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toEqual(expect.any(String));

    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);

    const afterLogout = await agent.post('/api/auth/refresh');
    expect(afterLogout.status).toBe(401);
  });

  it('rechaza refresh sin cookie (401)', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_REQUIRED');
  });
});

describe('revocación de sesiones (regresión auditoría)', () => {
  it('rechaza el access token tras logout (401)', async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send(adminCredentials());
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.data.accessToken as string;

    const before = await request(app).get('/api/auth/me').set(bearer(token));
    expect(before.status).toBe(200);

    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);

    const after = await request(app).get('/api/auth/me').set(bearer(token));
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHORIZED');

    const admin = await request(app).get('/api/admin/legal/terminos').set(bearer(token));
    expect(admin.status).toBe(401);
  });

  it('rechaza tokens de sesiones revocadas por change-password (401) y los restaura', async () => {
    const tokenA = await login(app);

    const agentB = request.agent(app);
    const loginB = await agentB.post('/api/auth/login').send(adminCredentials());
    const tokenB = loginB.body.data.accessToken as string;

    const { password } = adminCredentials();
    const temporal = 'Temporal-Clave-2026!';
    const change = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(tokenB))
      .send({ currentPassword: password, newPassword: temporal });
    expect(change.status).toBe(200);

    // La sesión A quedó revocada: su access token ya no sirve.
    const resA = await request(app).get('/api/auth/me').set(bearer(tokenA));
    expect(resA.status).toBe(401);

    // La sesión que hizo el cambio sigue activa; restaura la contraseña.
    const restore = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(tokenB))
      .send({ currentPassword: temporal, newPassword: password });
    expect(restore.status).toBe(200);
  });

  it('solo una de dos peticiones refresh concurrentes consume el token (200 + 401)', async () => {
    const loginRes = await request(app).post('/api/auth/login').send(adminCredentials());
    const raw = (loginRes.headers as Record<string, string | string[]>)['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [String(raw ?? '')])
      .find((c) => c.startsWith('ayr_rt='))
      ?.split(';')[0];
    expect(cookie).toBeTruthy();

    const [r1, r2] = await Promise.all([
      request(app).post('/api/auth/refresh').set('Cookie', cookie as string),
      request(app).post('/api/auth/refresh').set('Cookie', cookie as string),
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 401]);
  });
});

describe('POST /api/auth/change-password', () => {
  it('valida longitud mínima de la nueva contraseña (400)', async () => {
    const token = await login(app);
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: 'x', newPassword: 'corto' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza la contraseña actual incorrecta (401)', async () => {
    const token = await login(app);
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: 'esta-tampoco-es', newPassword: 'Nueva-Clave-2026!' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_PASSWORD');
  });

  it('exige autenticación (401)', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'x', newPassword: 'Nueva-Clave-2026!' });
    expect(res.status).toBe(401);
  });
});
