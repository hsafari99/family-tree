import { type HealthResponse, healthResponseSchema } from '@family-tree/shared';

/** Absolute API origin from VITE_API_BASE_URL, without a trailing slash; empty in dev. */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/v1/health`, { credentials: 'include', signal });
  return healthResponseSchema.parse(await res.json());
}
