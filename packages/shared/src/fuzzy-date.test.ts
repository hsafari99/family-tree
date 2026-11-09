import { describe, expect, it } from 'vitest';
import { fuzzyDateSchema, precisionOf, sortYear } from './fuzzy-date.js';

describe('fuzzyDateSchema', () => {
  it.each([
    { qualifier: 'exact', date1: '1948-03-21' },
    { qualifier: 'about', date1: '1920' },
    { qualifier: 'before', date1: '1950-06' },
    { qualifier: 'after', date1: '2001' },
    { qualifier: 'between', date1: '1950', date2: '1955' },
    { qualifier: 'exact', date1: '2024-02-29' },
  ])('accepts %o', (value) => {
    expect(fuzzyDateSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['bad format', { qualifier: 'exact', date1: '21/03/1948' }],
    ['month 13', { qualifier: 'exact', date1: '1948-13' }],
    ['Feb 30', { qualifier: 'exact', date1: '1948-02-30' }],
    ['Feb 29 on non-leap year', { qualifier: 'exact', date1: '2023-02-29' }],
    ['between without date2', { qualifier: 'between', date1: '1950' }],
    ['between with date2 before date1', { qualifier: 'between', date1: '1955', date2: '1950' }],
    ['date2 on non-between', { qualifier: 'about', date1: '1950', date2: '1955' }],
    ['unknown qualifier', { qualifier: 'circa', date1: '1950' }],
  ])('rejects %s', (_label, value) => {
    expect(fuzzyDateSchema.safeParse(value).success).toBe(false);
  });
});

describe('precisionOf', () => {
  it('derives precision from the string length', () => {
    expect(precisionOf('1920')).toBe('year');
    expect(precisionOf('1920-05')).toBe('month');
    expect(precisionOf('1920-05-17')).toBe('day');
  });
});

describe('sortYear', () => {
  it('uses the year of date1', () => {
    expect(sortYear({ qualifier: 'about', date1: '1920' })).toBe(1920);
    expect(sortYear({ qualifier: 'between', date1: '1950-02', date2: '1955' })).toBe(1950);
    expect(sortYear({ qualifier: 'exact', date1: '0987-01-01' })).toBe(987);
  });
});
