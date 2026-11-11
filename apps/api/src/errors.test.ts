import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { createTreeSchema, updatePersonSchema } from '@family-tree/shared';
import {
  AppError,
  conflict,
  forbidden,
  idParam,
  invalid,
  isUniqueViolation,
  parseBody,
  safeError,
} from './errors.js';

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

describe('parseBody with a future birth or death date', () => {
  const next = { qualifier: 'exact', date1: String(new Date().getUTCFullYear() + 1) };
  const detailsOf = (fn: () => unknown): Record<string, unknown> => {
    try {
      fn();
    } catch (err) {
      return (err as AppError).details as Record<string, unknown>;
    }
    throw new Error('expected a VALIDATION error');
  };
  it('names the date field', () => {
    expect(
      Object.keys(detailsOf(() => parseBody(updatePersonSchema, { version: 1, deathDate: next }))),
    ).toEqual(['deathDate']);
    expect(
      Object.keys(detailsOf(() => parseBody(updatePersonSchema, { version: 1, birthDate: next }))),
    ).toEqual(['birthDate']);
    // Quick add and new tree nest the person: the top-level key is what the client gets.
    expect(
      Object.keys(
        detailsOf(() =>
          parseBody(createTreeSchema, { name: 'x', person: { givenName: 'a', birthDate: next } }),
        ),
      ),
    ).toEqual(['person']);
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

describe('idParam and forbidden', () => {
  const uuid = '0b0c8a4e-1f7e-4c1a-9a51-6a2a3c9d0e11';
  it('returns a valid uuid parameter', () => {
    expect(idParam({ treeId: uuid }, 'treeId')).toBe(uuid);
  });
  it('turns anything else into a 404 NOT_FOUND', () => {
    try {
      idParam({ treeId: 'not-a-uuid' }, 'treeId');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(404);
      expect((err as AppError).code).toBe('NOT_FOUND');
    }
  });
  it('forbidden() is a 403 FORBIDDEN', () => {
    const err = forbidden();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });
});

describe('invalid, conflict and isUniqueViolation', () => {
  it('invalid is a VALIDATION error naming the field', () => {
    const e = invalid('x', 'msg');
    expect(e).toBeInstanceOf(AppError);
    expect(e).toMatchObject({ code: 'VALIDATION', statusCode: 400, details: { x: ['msg'] } });
  });
  it('conflict is a 409', () => {
    expect(conflict('m')).toMatchObject({ code: 'CONFLICT', statusCode: 409, message: 'm' });
  });
  it('finds a unique violation in the cause chain', () => {
    const pg = Object.assign(new Error('dup'), { code: '23505' });
    const wrapped = new Error('outer', { cause: new Error('mid', { cause: pg }) });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error('fk'), { code: '23503' }))).toBe(false);
    expect(isUniqueViolation(new Error('plain'))).toBe(false);
  });
});
