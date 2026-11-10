import { describe, expect, it } from 'vitest';
import { securityHeaders } from '../../../web/security-headers.js';
import { loadConfig } from '../config.js';
import { createObjectStore } from './objects.js';

// Production settings as compose.prod.yml passes them (S3_FORCE_PATH_STYLE is not set there).
const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://family_app:Str0ngPassw0rd@postgres:5432/family',
  WEB_ORIGIN: 'https://family.example.com',
  AUTH_BASE_URL: 'https://api.family.example.com',
  SESSION_SECRET: 'test-only-prod-like-session-secret-0123456789abcdef',
  S3_ENDPOINT: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  S3_PUBLIC_ENDPOINT: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'family-photos',
  S3_ACCESS_KEY_ID: 'AKIAREALKEY',
  S3_SECRET_ACCESS_KEY: 'realsecretvalue',
};

describe('signed photo URLs and the CSP', () => {
  it("point at exactly the origin the web app's img-src allows", async () => {
    const store = createObjectStore(loadConfig(prod));
    const url = new URL(await store.signedUrl('trees/t/photos/p.webp'));
    const csp = securityHeaders({
      apiOrigin: prod.AUTH_BASE_URL,
      photoOrigin: prod.S3_PUBLIC_ENDPOINT,
    })['Content-Security-Policy']!;
    const imgSrc = csp.split('; ').find((d) => d.startsWith('img-src '))!;
    expect(imgSrc.split(' ')).toContain(url.origin);
    // Path-style: the bucket is in the path, not the host.
    expect(url.hostname).toBe('0123456789abcdef.r2.cloudflarestorage.com');
    expect(url.pathname.startsWith('/family-photos/')).toBe(true);
    store.close();
  });
});
