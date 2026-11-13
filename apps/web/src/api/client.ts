/** Absolute API origin from VITE_API_BASE_URL, without a trailing slash; empty in dev. */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
