import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHealth } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

const respond = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

describe('getHealth', () => {
  it('returns the parsed body for 200', async () => {
    respond(200, { status: 'ok', checks: { db: 'ok', storage: 'ok' } });
    await expect(getHealth()).resolves.toEqual({
      status: 'ok',
      checks: { db: 'ok', storage: 'ok' },
    });
  });

  it('returns the degraded body for 503 instead of throwing', async () => {
    respond(503, { status: 'degraded', checks: { db: 'error', storage: 'ok' } });
    await expect(getHealth()).resolves.toMatchObject({ status: 'degraded' });
  });

  it('throws on a malformed body', async () => {
    respond(200, { hello: 'world' });
    await expect(getHealth()).rejects.toThrow();
  });
});
