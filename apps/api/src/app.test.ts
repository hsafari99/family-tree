import { afterEach, describe, expect, it } from 'vitest';
import { testConfig } from '../test/test-config.js';
import { buildApp } from './app.js';

const checks = { checkDb: async () => {}, checkStorage: async () => {} };
let app: ReturnType<typeof buildApp> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('buildApp', () => {
  it('returns the standard error envelope for unknown routes', async () => {
    app = buildApp({ config: testConfig(), checks });
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('sets security headers', async () => {
    app = buildApp({ config: testConfig(), checks });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows CORS only for the configured web origin', async () => {
    app = buildApp({ config: testConfig(), checks });
    const preflight = (origin: string) =>
      app!.inject({
        method: 'OPTIONS',
        url: '/api/v1/health',
        headers: { origin, 'access-control-request-method': 'GET' },
      });
    expect((await preflight('http://localhost:5173')).headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(
      (await preflight('https://evil.example')).headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  it('hides internal error details behind a generic 500', async () => {
    app = buildApp({ config: testConfig(), checks });
    app.get('/boom', async () => {
      throw new Error('secret stack detail');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });
});
