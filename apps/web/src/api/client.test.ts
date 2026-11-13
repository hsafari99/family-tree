import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('API_BASE', () => {
  it('is VITE_API_BASE_URL without a trailing slash', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com/');
    vi.resetModules();
    const { API_BASE } = await import('./client');
    expect(API_BASE).toBe('https://api.example.com');
  });

  it('is empty when unset (dev: same origin)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.resetModules();
    const { API_BASE } = await import('./client');
    expect(API_BASE).toBe('');
  });
});
