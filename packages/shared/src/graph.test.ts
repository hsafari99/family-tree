import { describe, expect, it } from 'vitest';
import {
  childOrderSchema,
  compareSiblings,
  type GraphQuery,
  graphQuerySchema,
  similarQuerySchema,
  treeGraphSchema,
} from './graph.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('graphQuerySchema', () => {
  it('defaults to a depth-1 focus view and coerces the depth from the query string', () => {
    expect(graphQuerySchema.parse({})).toEqual({ mode: 'focus', depth: 1 });
    expect(graphQuerySchema.parse({ focus: id, depth: '3' })).toEqual({
      mode: 'focus',
      focus: id,
      depth: 3,
    });
  });
  it('rejects depths outside 1..3, bad modes and bad ids', () => {
    for (const q of [
      { depth: '0' },
      { depth: '4' },
      { depth: 'x' },
      { mode: 'all' },
      { focus: 'nope' },
    ]) {
      expect(graphQuerySchema.safeParse(q).success).toBe(false);
    }
  });
});

describe('similarQuerySchema', () => {
  it('needs a first name; blank surname is dropped; the year is coerced', () => {
    expect(
      similarQuerySchema.parse({ givenName: ' Ada ', surname: ' ', birthYear: '1815' }),
    ).toEqual({
      givenName: 'Ada',
      birthYear: 1815,
    });
    expect(similarQuerySchema.safeParse({ givenName: '' }).success).toBe(false);
  });
});

describe('childOrderSchema', () => {
  it('needs at least two distinct ids', () => {
    expect(childOrderSchema.safeParse({ childIds: [id] }).success).toBe(false);
    expect(childOrderSchema.safeParse({ childIds: [id, id] }).success).toBe(false);
  });
});

describe('compareSiblings', () => {
  it('orders by sibling order, then birth year, then given name; unknowns last', () => {
    const p = (givenName: string, siblingOrder: number | null, birthYear: number | null) => ({
      givenName,
      siblingOrder,
      birthYear,
    });
    const sorted = [
      p('C', null, null),
      p('B', null, 1990),
      p('A', 2, null),
      p('Z', 1, 2000),
      p('D', null, 1980),
    ]
      .sort(compareSiblings)
      .map((x) => x.givenName);
    expect(sorted).toEqual(['Z', 'A', 'D', 'B', 'C']);
  });
});

describe('treeGraphSchema', () => {
  it('accepts an empty needs-branch response', () => {
    expect(
      treeGraphSchema.safeParse({
        mode: 'full',
        focusId: null,
        branchId: null,
        persons: [],
        unions: [],
        links: [],
        total: 2500,
        truncated: false,
        needsBranch: true,
      }).success,
    ).toBe(true);
  });
});

// Type-level check: the input type must allow numbers and strings (fails to compile if `unknown`).
const q: GraphQuery = { depth: 2 };
void q;
