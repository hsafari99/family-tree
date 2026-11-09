import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
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
    setupFiles: ['./src/test/setup.ts'],
  },
});
