/**
 * Response headers for the static site (spec §8 "strict CSP on the frontend"; decision 13): one
 * source for Cloudflare Pages (`dist/_headers`) and the local stand-in (`dist/_headers.caddy`).
 */
export interface SiteOrigins {
  /** VITE_API_BASE_URL: fetches and uploads go here (Phase 6: never straight to storage). */
  apiOrigin: string;
  /** VITE_PHOTO_ORIGIN: where signed photo URLs point (R2's S3 endpoint in production). */
  photoOrigin: string;
}

export const IMMUTABLE = 'public, max-age=31536000, immutable';

function httpsOrigin(value: string, name: string): string {
  const url = URL.canParse(value) ? new URL(value) : null;
  if (!url || url.protocol !== 'https:' || value.replace(/\/+$/, '') !== url.origin) {
    throw new Error(`${name} must be an https origin like https://api.example.com`);
  }
  return url.origin;
}

export function securityHeaders({ apiOrigin, photoOrigin }: SiteOrigins): Record<string, string> {
  const api = httpsOrigin(apiOrigin, 'VITE_API_BASE_URL');
  const photos = httpsOrigin(photoOrigin, 'VITE_PHOTO_ORIGIN');
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    // React Flow sets inline style attributes (transforms, sizes); hashes can't cover them.
    "style-src 'self' 'unsafe-inline'",
    // data: for the QR code, blob: for the cropper's preview.
    `img-src 'self' data: blob: ${photos}`,
    `connect-src 'self' ${api}`,
    // The ELK layout worker is a same-origin asset.
    "worker-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

/** Cloudflare Pages `_headers`: every path, plus long caching for hashed assets. */
export function pagesHeadersFile(headers: Record<string, string>): string {
  return [
    '/*',
    ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`),
    '/assets/*',
    `  Cache-Control: ${IMMUTABLE}`,
    '',
  ].join('\n');
}

/** The same headers as Caddy directives, imported by docker/caddy/Caddyfile.local. */
export function caddyHeadersSnippet(headers: Record<string, string>): string {
  const q = (v: string) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  return [
    'header {',
    ...Object.entries(headers).map(([k, v]) => `\t${k} ${q(v)}`),
    '}',
    '@assets path /assets/*',
    `header @assets Cache-Control ${q(IMMUTABLE)}`,
    '',
  ].join('\n');
}
