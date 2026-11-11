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

  it('knows the codes for moving 2FA to a new phone', () => {
    for (const code of [
      'TWO_FACTOR_NOT_ENABLED',
      'ACCOUNT_TEMPORARILY_LOCKED',
      'MOVE_NOT_STARTED',
      'MOVE_EXPIRED',
    ]) {
      expect(apiErrorSchema.safeParse({ error: { code, message: 'x' } }).success).toBe(true);
    }
  });
});
