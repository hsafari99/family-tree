import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';

const config = loadConfig();
const deps = createDeps(config);
const app = buildApp({ config, checks: deps.checks });

afterAll(async () => {
  await app.close();
  await deps.close();
});

describe('health against real Postgres and S3', () => {
  it('reports ok for db and storage', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.json()).toEqual({ status: 'ok', checks: { db: 'ok', storage: 'ok' } });
    expect(res.statusCode).toBe(200);
  });

  it('reports storage error for a bucket that does not exist', async () => {
    const broken = createDeps({ ...config, S3_BUCKET: 'bucket-that-does-not-exist' });
    const brokenApp = buildApp({ config, checks: broken.checks });
    const res = await brokenApp.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual({ db: 'ok', storage: 'error' });
    await brokenApp.close();
    await broken.close();
  });
});
