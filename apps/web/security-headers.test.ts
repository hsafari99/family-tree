import { describe, expect, it } from 'vitest';
import { caddyHeadersSnippet, pagesHeadersFile, securityHeaders } from './security-headers';

const origins = {
  apiOrigin: 'https://api.family.example.com',
  photoOrigin: 'https://abc.r2.cloudflarestorage.com',
};

describe('securityHeaders', () => {
  it('builds a strict CSP around the API and photo origins', () => {
    const csp = securityHeaders(origins)['Content-Security-Policy']!;
    const directives = Object.fromEntries(
      csp.split('; ').map((d) => {
        const [name, ...values] = d.split(' ');
        return [name, values.join(' ')];
      }),
    );
    expect(directives).toEqual({
      'default-src': "'none'",
      'script-src': "'self'",
      'style-src': "'self'",
      'img-src': "'self' data: blob: https://abc.r2.cloudflarestorage.com",
      'connect-src': "'self' https://api.family.example.com",
      'worker-src': "'self'",
      'font-src': "'self'",
      'manifest-src': "'self'",
      'base-uri': "'none'",
      'form-action': "'self'",
      'frame-ancestors': "'none'",
      'object-src': "'none'",
    });
    expect(csp).not.toMatch(/unsafe-eval|\*/);
  });

  it('sets the other hardening headers', () => {
    const h = securityHeaders(origins);
    expect(h).toMatchObject({
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    });
    expect(h['Permissions-Policy']).toContain('camera=()');
  });

  it('accepts a trailing slash or a port, and refuses paths and http', () => {
    const csp = securityHeaders({
      apiOrigin: 'https://api.family.test:8443/',
      photoOrigin: 'https://s3.family.test:8443',
    })['Content-Security-Policy'];
    expect(csp).toContain("connect-src 'self' https://api.family.test:8443;");
    expect(() => securityHeaders({ ...origins, apiOrigin: 'https://api.example.com/v1' })).toThrow(
      /VITE_API_BASE_URL/,
    );
    expect(() => securityHeaders({ ...origins, photoOrigin: 'http://r2.example.com' })).toThrow(
      /VITE_PHOTO_ORIGIN/,
    );
  });
});

describe('pagesHeadersFile', () => {
  it('renders the Cloudflare Pages _headers format, with immutable assets', () => {
    expect(pagesHeadersFile({ A: '1', 'B-C': 'x y' })).toBe(
      '/*\n  A: 1\n  B-C: x y\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n',
    );
  });
});

describe('caddyHeadersSnippet', () => {
  it('renders a Caddy header block with quoted values', () => {
    expect(caddyHeadersSnippet({ A: 'it\'s "q"' })).toBe(
      'header {\n\tA "it\'s \\"q\\""\n}\n@assets path /assets/*\n' +
        'header @assets Cache-Control "public, max-age=31536000, immutable"\n',
    );
  });
});
