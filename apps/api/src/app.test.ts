import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { testConfig } from '../test/test-config.js';
import { buildApp } from './app.js';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { AppError } from './errors.js';

const checks = { checkDb: async () => {}, checkStorage: async () => {} };

/** Collects log lines written by the app. */
function logSink() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { stream, text: () => lines.join('') };
}
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

  it('allows PATCH and DELETE in CORS preflights', async () => {
    const config = testConfig();
    app = buildApp({ config, checks });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/health',
      headers: { origin: config.WEB_ORIGIN, 'access-control-request-method': 'DELETE' },
    });
    expect(res.statusCode).toBe(204);
    const methods = String(res.headers['access-control-allow-methods']);
    expect(methods).toContain('DELETE');
    expect(methods).toContain('PATCH');
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

  it('logs an AppError with a 5xx status', async () => {
    const sink = logSink();
    app = buildApp({
      config: testConfig({ LOG_LEVEL: 'error' }),
      checks,
      logStream: sink.stream,
    });
    app.get('/unavailable', async () => {
      throw new AppError('INTERNAL', 503, 'Try again later');
    });
    const res = await app.inject({ method: 'GET', url: '/unavailable' });
    expect(res.statusCode).toBe(503);
    expect(sink.text()).toContain('Try again later');
  });

  it('does not log an AppError with a 4xx status', async () => {
    const sink = logSink();
    app = buildApp({
      config: testConfig({ LOG_LEVEL: 'error' }),
      checks,
      logStream: sink.stream,
    });
    app.get('/conflict', async () => {
      throw new AppError('CONFLICT', 409, 'Already exists');
    });
    await app.inject({ method: 'GET', url: '/conflict' });
    expect(sink.text()).not.toContain('Already exists');
  });

  it('keeps the request body out of a 500 error log', async () => {
    const sink = logSink();
    app = buildApp({
      config: testConfig({ LOG_LEVEL: 'info' }),
      checks,
      logStream: sink.stream,
    });
    app.post('/boom', async () => {
      throw new Error('kaboom');
    });
    const res = await app.inject({
      method: 'POST',
      url: '/boom',
      headers: { origin: 'http://localhost:5173', cookie: 'ft.session_token=secret-cookie-value' },
      payload: { email: 'ann@example.com', password: 'hunter2-hunter2' },
    });
    expect(res.statusCode).toBe(500);
    const log = sink.text();
    expect(log).toContain('kaboom');
    expect(log).not.toContain('hunter2');
    expect(log).not.toContain('ann@example.com');
    expect(log).not.toContain('secret-cookie-value');
  });

  it('redacts the export ticket from the logged request URL', async () => {
    const sink = logSink();
    app = buildApp({ config: testConfig({ LOG_LEVEL: 'info' }), checks, logStream: sink.stream });
    app.get('/dl', async () => 'ok');
    await app.inject({ method: 'GET', url: '/dl?ticket=SECRET-ticket_value&x=1' });
    const log = sink.text();
    expect(log).toContain('/dl?');
    expect(log).toContain('x=1');
    expect(log).not.toContain('SECRET-ticket_value');
  });

  it('keeps database query parameters out of the error log', async () => {
    const sink = logSink();
    app = buildApp({ config: testConfig({ LOG_LEVEL: 'info' }), checks, logStream: sink.stream });
    app.get('/db-fail', async () => {
      throw new DrizzleQueryError(
        'select * from "users" where "email" = $1',
        ['ann@example.com', 'secret-token-value'],
        Object.assign(new Error('connection reset'), { code: '08006' }),
      );
    });
    const res = await app.inject({ method: 'GET', url: '/db-fail' });
    expect(res.statusCode).toBe(500);
    const log = sink.text();
    expect(log).toContain('Failed query: select * from');
    expect(log).toContain('08006');
    expect(log).not.toContain('ann@example.com');
    expect(log).not.toContain('secret-token-value');
  });

  it('maps a thrown 404 error to NOT_FOUND', async () => {
    app = buildApp({ config: testConfig(), checks });
    app.get('/missing', async () => {
      throw Object.assign(new Error('row 42 missing in table x'), { statusCode: 404 });
    });
    const res = await app.inject({ method: 'GET', url: '/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('trusts exactly TRUST_PROXY hops of X-Forwarded-For', async () => {
    const ipOf = async (trustProxy: string) => {
      const scoped = buildApp({ config: testConfig({ TRUST_PROXY: trustProxy }), checks });
      try {
        scoped.get('/ip', async (req) => ({ ip: req.ip }));
        const res = await scoped.inject({
          method: 'GET',
          url: '/ip',
          headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' },
        });
        return res.json().ip as string;
      } finally {
        await scoped.close();
      }
    };
    expect(await ipOf('0')).toBe('127.0.0.1');
    // One trusted hop (Caddy): the entry it appended, not the spoofable leftmost one.
    expect(await ipOf('1')).toBe('203.0.113.7');
    expect(await ipOf('2')).toBe('6.6.6.6');
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
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
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
