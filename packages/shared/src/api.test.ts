import { describe, expect, it } from 'vitest';
import { apiErrorSchema, healthResponseSchema } from './api.js';

describe('healthResponseSchema', () => {
  it('accepts ok and degraded responses', () => {
    expect(
      healthResponseSchema.parse({ status: 'ok', checks: { db: 'ok', storage: 'ok' } }).status,
    ).toBe('ok');
    expect(
      healthResponseSchema.parse({ status: 'degraded', checks: { db: 'error', storage: 'ok' } })
        .checks.db,
    ).toBe('error');
  });

  it('rejects unknown statuses', () => {
    expect(
      healthResponseSchema.safeParse({ status: 'meh', checks: { db: 'ok', storage: 'ok' } })
        .success,
    ).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  it('accepts the standard error envelope', () => {
    expect(
      apiErrorSchema.parse({ error: { code: 'NOT_FOUND', message: 'Not found' } }).error.code,
    ).toBe('NOT_FOUND');
  });
});
