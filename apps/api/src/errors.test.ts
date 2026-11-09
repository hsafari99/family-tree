import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, parseBody } from './errors.js';

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
