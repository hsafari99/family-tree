import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { AppError, parseBody, safeError } from './errors.js';

describe('parseBody', () => {
  const schema = z.object({ email: z.email() });
  it('returns parsed data', () => {
    expect(parseBody(schema, { email: 'a@b.co' })).toEqual({ email: 'a@b.co' });
  });
  it('throws a VALIDATION AppError listing the field', () => {
    try {
      parseBody(schema, { email: 'nope' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('VALIDATION');
      expect((err as AppError).statusCode).toBe(400);
      expect(JSON.stringify((err as AppError).details)).toContain('email');
    }
  });
});

describe('safeError', () => {
  const pgError = Object.assign(new Error('duplicate key value'), {
    code: '23505',
    constraint_name: 'reset_links_token_hash_unique',
  });
  const query = () =>
    new DrizzleQueryError(
      'insert into "reset_links" ("token_hash") values ($1)',
      ['secret-token-hash', 'ann@example.com'],
      pgError,
    );

  it('keeps only the first line, code and constraint of a Drizzle query error', () => {
    const safe = safeError(query());
    expect(safe).toEqual({
      name: 'DrizzleQueryError',
      message: 'Failed query: insert into "reset_links" ("token_hash") values ($1)',
      code: '23505',
      constraint: 'reset_links_token_hash_unique',
    });
    expect(JSON.stringify(safe)).not.toContain('secret-token-hash');
  });

  it('sanitises an error that wraps a Drizzle query error', () => {
    const safe = safeError(new Error('reset failed', { cause: query() }));
    expect(JSON.stringify(safe)).not.toContain('ann@example.com');
    expect(safe).toMatchObject({ message: 'reset failed', code: '23505' });
  });

  it('returns other errors unchanged', () => {
    const err = new Error('plain');
    expect(safeError(err)).toBe(err);
    expect(safeError('text')).toBe('text');
  });
});
