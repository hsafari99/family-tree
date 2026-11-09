import type { ApiError } from '@family-tree/shared';
import { z } from 'zod';

type ErrorCode = ApiError['error']['code'];

/** The only error type whose message is shown to clients. */
export class AppError extends Error {
  override name = 'AppError';
  constructor(
    readonly code: ErrorCode,
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(
      'VALIDATION',
      400,
      'Some fields are invalid',
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
