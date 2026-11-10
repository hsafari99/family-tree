import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { caddyHeadersSnippet, pagesHeadersFile, securityHeaders } from './security-headers';

/** dist/_headers (Cloudflare Pages), and dist/_headers.caddy for the local stack (decision 13). */
function siteHeaders(): Plugin {
  return {
    name: 'family-tree-site-headers',
    apply: 'build',
    generateBundle() {
      const apiOrigin = process.env.VITE_API_BASE_URL;
      const photoOrigin = process.env.VITE_PHOTO_ORIGIN;
      if (!apiOrigin || !photoOrigin) {
        const msg =
          'VITE_API_BASE_URL and VITE_PHOTO_ORIGIN are not set, so no _headers file was written ' +
          '(fine for dev and CI builds, never for a deployment)';
        // Cloudflare Pages sets CF_PAGES=1: a deployment must not ship without its CSP.
        if (process.env.CF_PAGES === '1') this.error(msg);
        this.warn(msg);
        return;
      }
      const headers = securityHeaders({ apiOrigin, photoOrigin });
      this.emitFile({ type: 'asset', fileName: '_headers', source: pagesHeadersFile(headers) });
      if (process.env.WEB_HEADERS_CADDY === '1') {
        this.emitFile({
          type: 'asset',
          fileName: '_headers.caddy',
          source: caddyHeadersSnippet(headers),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), siteHeaders()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // API_PROXY_TARGET is read by the dev server only; it has no VITE_ prefix,
      // so it is never exposed to client code.
      '/api/': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000' },
    },
  },
  test: {
    environment: 'jsdom',
    testTimeout: 15_000,
    setupFiles: ['./src/test/setup.ts'],
  },
});
