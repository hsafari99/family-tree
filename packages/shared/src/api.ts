import { z } from 'zod';

export const checkStatusSchema = z.enum(['ok', 'error']);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({ db: checkStatusSchema, storage: checkStatusSchema }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'INVALID_RESET',
  'INTERNAL',
] as const;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
