import { describe, expect, it } from 'vitest';
import { searchQuerySchema } from './search.js';

const ok = (q: Record<string, unknown>) => searchQuerySchema.safeParse(q);

describe('searchQuerySchema (decision 18)', () => {
  it('needs a name or a filter', () => {
    expect(ok({}).success).toBe(false);
    expect(ok({ q: '   ' }).success).toBe(false);
    expect(ok({ q: 'hale' }).success).toBe(true);
    expect(ok({ status: 'deceased' }).success).toBe(true);
    expect(ok({ place: 'Leeds' }).success).toBe(true);
  });
  it('treats blank query-string values as not given', () => {
    expect(
      searchQuerySchema.parse({ q: 'x', bornFrom: '', status: '', branch: '', place: '' }),
    ).toEqual({
      q: 'x',
      limit: 20,
    });
  });
  it('coerces years and limits, and checks ranges', () => {
    expect(searchQuerySchema.parse({ bornFrom: '1900', bornTo: '1950', limit: '5' })).toMatchObject(
      {
        bornFrom: 1900,
        bornTo: 1950,
        limit: 5,
      },
    );
    expect(ok({ bornFrom: 1950, bornTo: 1900 }).success).toBe(false);
    expect(ok({ diedFrom: 2000, diedTo: 1990 }).success).toBe(false);
    expect(ok({ q: 'x', limit: 51 }).success).toBe(false);
    expect(ok({ q: 'x', status: 'zombie' }).success).toBe(false);
    expect(ok({ q: 'x', branch: 'not-a-uuid' }).success).toBe(false);
  });
});
