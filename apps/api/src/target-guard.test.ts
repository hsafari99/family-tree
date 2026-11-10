import { describe, expect, it } from 'vitest';
import { assertServerTarget, assertTestTargets } from './target-guard.js';

const pg = (name: string) => `postgres://u:p@localhost:5432/${name}`;

describe('assertTestTargets', () => {
  it('accepts a _test database with a -test bucket', () => {
    expect(() =>
      assertTestTargets({ DATABASE_URL: pg('family_test'), S3_BUCKET: 'family-photos-test' }),
    ).not.toThrow();
  });

  it.each([
    [pg('family'), 'family-photos-test', /database/],
    [pg('family_test'), 'family-photos', /bucket/],
  ])('refuses %s with bucket %s', (DATABASE_URL, S3_BUCKET, message) => {
    expect(() => assertTestTargets({ DATABASE_URL, S3_BUCKET })).toThrow(message);
  });
});

describe('assertServerTarget', () => {
  it('refuses a _test database outside NODE_ENV=test', () => {
    for (const NODE_ENV of ['development', 'production'] as const) {
      expect(() => assertServerTarget({ DATABASE_URL: pg('family_test'), NODE_ENV })).toThrow(
        /_test/,
      );
    }
  });

  it('allows it under test, and any other name anywhere', () => {
    expect(() =>
      assertServerTarget({ DATABASE_URL: pg('family_test'), NODE_ENV: 'test' }),
    ).not.toThrow();
    expect(() =>
      assertServerTarget({ DATABASE_URL: pg('family'), NODE_ENV: 'production' }),
    ).not.toThrow();
  });
});
