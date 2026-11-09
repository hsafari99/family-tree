import { afterEach, describe, expect, it } from 'vitest';
import { testConfig } from '../test/test-config.js';
import { buildApp } from './app.js';
import { AppError } from './errors.js';

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

  it('returns an AppError with its own code, status and message', async () => {
    app = buildApp({ config: testConfig(), checks });
    app.get('/conflict', async () => {
      throw new AppError('CONFLICT', 409, 'Already exists');
    });
    const res = await app.inject({ method: 'GET', url: '/conflict' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'CONFLICT', message: 'Already exists' } });
  });

  it('maps other 4xx errors to BAD_REQUEST without leaking their message', async () => {
    app = buildApp({ config: testConfig(), checks });
    app.get('/leaky', async () => {
      throw Object.assign(new Error('secret internal detail'), { statusCode: 409 });
    });
    const res = await app.inject({ method: 'GET', url: '/leaky' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Request could not be processed' },
    });
    expect(res.body).not.toContain('secret');
  });

  it('returns BAD_REQUEST for invalid JSON', async () => {
    app = buildApp({ config: testConfig(), checks });
    app.post('/echo', async (req) => req.body);
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('applies the global rate limit', async () => {
    app = buildApp({ config: testConfig(), checks, rateLimitMax: 3 });
    // Inside a plugin, like real routes, so it loads after the rate-limit plugin's onRoute hook.
    app.register(async (scope) => {
      scope.get('/limited', async () => ({ ok: true }));
    });
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/limited' })).statusCode).toBe(200);
    }
    const res = await app.inject({ method: 'GET', url: '/limited' });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' },
    });
  });

  it('gives the health route its own limit of 60 per minute', async () => {
    app = buildApp({ config: testConfig(), checks, rateLimitMax: 3 });
    for (let i = 0; i < 60; i++) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    }
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });
});
