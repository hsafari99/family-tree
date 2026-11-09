import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { healthRoutes, type HealthChecks } from './health.js';

const ok = async () => {};
const fail = async () => {
  throw new Error('down');
};
const hang = () => new Promise<void>(() => {});

async function call(checks: HealthChecks) {
  const app = Fastify();
  await app.register(healthRoutes, { checks, timeoutMs: 50 });
  const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
  await app.close();
  return res;
}

describe('GET /api/v1/health', () => {
  it('returns 200 when every check passes', async () => {
    const res = await call({ checkDb: ok, checkStorage: ok });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { db: 'ok', storage: 'ok' } });
  });

  it('returns 503 and names the failing check without leaking details', async () => {
    const res = await call({ checkDb: fail, checkStorage: ok });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', checks: { db: 'error', storage: 'ok' } });
    expect(res.body).not.toContain('down');
  });

  it('treats a hanging check as an error after the timeout', async () => {
    const res = await call({ checkDb: ok, checkStorage: hang });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.storage).toBe('error');
  });
});
