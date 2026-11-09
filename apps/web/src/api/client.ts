import { type HealthResponse, healthResponseSchema } from '@family-tree/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/v1/health`, { credentials: 'include' });
  return healthResponseSchema.parse(await res.json());
}
