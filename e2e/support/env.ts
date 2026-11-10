/** Which stack the tests drive (decisions 15, 16). */
export const PROD_LOCAL = process.env.E2E_TARGET === 'prod-local';
export const WEB =
  process.env.E2E_BASE_URL ?? (PROD_LOCAL ? 'https://family.test:8443' : 'http://localhost:5173');
/** The API origin. In dev the Vite proxy serves it on the web origin. */
export const API = process.env.E2E_API_URL ?? (PROD_LOCAL ? 'https://api.family.test:8443' : WEB);
export const STATE = new URL('../.state/', import.meta.url).pathname;
export const statePath = (name: string) => `${STATE}${name}`;
export const REPO_ROOT = new URL('../../', import.meta.url).pathname;
