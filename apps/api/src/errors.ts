import type { ApiError } from '@family-tree/shared';
import { DrizzleQueryError } from 'drizzle-orm/errors';
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

export const notFound = () => new AppError('NOT_FOUND', 404, 'Not found');
export const forbidden = (message = 'You don’t have permission to do that') =>
  new AppError('FORBIDDEN', 403, message);

/** A uuid route parameter. Anything else is a 404: it can't name a row the user may see. */
export function idParam(params: unknown, key: string): string {
  const parsed = z.uuid().safeParse((params as Record<string, unknown> | null)?.[key]);
  if (!parsed.success) throw notFound();
  return parsed.data;
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

const PARAMS_MARKER = '\nparams:';

/** The first error in the cause chain that carries query parameters, if any. */
function findLeaky(err: Error): Error | undefined {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if (e instanceof DrizzleQueryError || e.message.includes(PARAMS_MARKER)) return e;
  }
  return undefined;
}

/**
 * What may be logged for an error. Drizzle's query errors put the bound parameters (tokens,
 * emails, password hashes) in their message and stack, so for those (or anything wrapping one)
 * only the first message line and the Postgres code and constraint are kept. Other errors are
 * returned unchanged, for pino's normal error serializer.
 */
export function safeError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const leaky = findLeaky(err);
  if (!leaky) return err;
  const pg = (leaky.cause ?? {}) as { code?: unknown; constraint_name?: unknown };
  return {
    // DrizzleQueryError doesn't set its own name.
    name: err instanceof DrizzleQueryError ? 'DrizzleQueryError' : err.name,
    // The first line is "Failed query: <sql with $n placeholders>"; the params follow it.
    message: err.message.split('\n', 1)[0],
    code: pg.code,
    constraint: pg.constraint_name,
  };
}

export const invalid = (field: string, message: string) =>
  new AppError('VALIDATION', 400, 'Some fields are invalid', { [field]: [message] });

export const conflict = (message: string) => new AppError('CONFLICT', 409, message);

/** A Postgres unique violation (23505) anywhere in the cause chain (Drizzle wraps driver errors). */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
