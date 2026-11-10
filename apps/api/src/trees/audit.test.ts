import { describe, expect, it } from 'vitest';
import { changedFields, stable } from './audit.js';

describe('changedFields', () => {
  it('returns only the fields that differ', () => {
    expect(
      changedFields({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', c: null }, ['a', 'b', 'c']),
    ).toEqual({ before: { b: 'x' }, after: { b: 'y' } });
  });
  it('ignores jsonb key order and undefined vs null', () => {
    const before = { d: { date1: '1950', qualifier: 'exact' }, e: null };
    const after = { d: { qualifier: 'exact', date1: '1950' }, e: undefined };
    expect(changedFields(before, after, ['d', 'e'])).toBeNull();
  });
});

describe('stable', () => {
  it('sorts object keys recursively', () => {
    expect(stable({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});
