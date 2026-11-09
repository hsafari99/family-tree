import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHealth } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
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

  it('calls the health endpoint with credentials and the given signal', async () => {
    respond(200, { status: 'ok', checks: { db: 'ok', storage: 'ok' } });
    const controller = new AbortController();
    await getHealth(controller.signal);
    expect(fetch).toHaveBeenCalledWith('/api/v1/health', {
      credentials: 'include',
      signal: controller.signal,
    });
  });

  it('prefixes VITE_API_BASE_URL without doubling a trailing slash', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com/');
    vi.resetModules();
    const { getHealth: getHealthWithBase } = await import('./client');
    respond(200, { status: 'ok', checks: { db: 'ok', storage: 'ok' } });
    await getHealthWithBase();
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/api/v1/health', {
      credentials: 'include',
      signal: undefined,
    });
  });
});
