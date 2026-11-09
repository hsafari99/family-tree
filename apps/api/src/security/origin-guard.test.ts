import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { testConfig } from '../../test/test-config.js';
import { buildApp } from '../app.js';

const checks = { checkDb: async () => {}, checkStorage: async () => {} };
let app: ReturnType<typeof buildApp> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function appWithRoutes() {
  app = buildApp({ config: testConfig(), checks });
  app.register(async (scope) => {
    scope.post('/api/v1/x', async () => ({ ok: true }));
    scope.get('/api/v1/x', async () => ({ ok: true }));
    scope.post('/api/auth/x', async () => ({ ok: true }));
  });
  return app;
}

describe('originGuard', () => {
  it('lets a state-changing /api/v1 request from the web origin through', async () => {
    const res = await appWithRoutes().inject({
      method: 'POST',
      url: '/api/v1/x',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a state-changing /api/v1 request from another origin', async () => {
    const res = await appWithRoutes().inject({
      method: 'POST',
      url: '/api/v1/x',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('rejects a state-changing /api/v1 request without an Origin header', async () => {
    const res = await appWithRoutes().inject({ method: 'POST', url: '/api/v1/x' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('lets GET through from any origin', async () => {
    const res = await appWithRoutes().inject({
      method: 'GET',
      url: '/api/v1/x',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('leaves /api/auth to Better Auth, which checks the origin itself', async () => {
    const res = await appWithRoutes().inject({
      method: 'POST',
      url: '/api/auth/x',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(200);
  });

  it.each(['/api/%761/x', '/%61pi/v1/x'])(
    'is not fooled by an encoded path (%s) from another origin',
    async (url) => {
      const res = await appWithRoutes().inject({
        method: 'POST',
        url,
        headers: { origin: 'https://evil.example' },
      });
      expect(res.statusCode).toBe(403);
    },
  );

  it('denies by default: a state-changing request to any non-auth route needs the origin', async () => {
    const plain = Fastify();
    try {
      const { originGuard } = await import('./origin-guard.js');
      plain.addHook('onRequest', originGuard('http://localhost:5173'));
      plain.post('/api/v10', async () => ({ ok: true }));
      const res = await plain.inject({ method: 'POST', url: '/api/v10' });
      expect(res.statusCode).toBe(403);
      const ok = await plain.inject({
        method: 'POST',
        url: '/api/v10',
        headers: { origin: 'http://localhost:5173' },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await plain.close();
    }
  });

  it('never lets an unmatched route answer 200 to a foreign origin', async () => {
    const res = await appWithRoutes().inject({
      method: 'POST',
      url: '/api/%762/x',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).not.toBe(200);
    expect([403, 404]).toContain(res.statusCode);
  });
});
