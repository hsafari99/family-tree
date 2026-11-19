/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for production builds; empty in dev (Vite proxies `/api/`). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** apps/web/package.json's version, set at build time (vite.config.ts). */
declare const __APP_VERSION__: string;
