/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin for production builds; empty in dev (Vite proxies `/api/`). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
