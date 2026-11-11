import { describe, expect, it } from 'vitest';
import {
  FUTURE_DATE_MESSAGE,
  fuzzyDateSchema,
  isFutureDate,
  pastFuzzyDateSchema,
  precisionOf,
  sortYear,
} from './fuzzy-date.js';

describe('fuzzyDateSchema', () => {
  it.each([
    { qualifier: 'exact', date1: '1948-03-21' },
    { qualifier: 'about', date1: '1920' },
    { qualifier: 'before', date1: '1950-06' },
    { qualifier: 'after', date1: '2001' },
    { qualifier: 'between', date1: '1950', date2: '1955' },
    { qualifier: 'exact', date1: '2024-02-29' },
    { qualifier: 'exact', date1: '2000-02-29' },
    { qualifier: 'between', date1: '1950-06', date2: '1950' },
    { qualifier: 'between', date1: '1950-06-15', date2: '1950-06' },
  ])('accepts %o', (value) => {
    expect(fuzzyDateSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['bad format', { qualifier: 'exact', date1: '21/03/1948' }],
    ['month 13', { qualifier: 'exact', date1: '1948-13' }],
    ['Feb 30', { qualifier: 'exact', date1: '1948-02-30' }],
    ['Feb 29 on non-leap year', { qualifier: 'exact', date1: '2023-02-29' }],
    ['Feb 29 on non-leap century', { qualifier: 'exact', date1: '1900-02-29' }],
    ['month 00', { qualifier: 'exact', date1: '1948-00' }],
    ['day 00', { qualifier: 'exact', date1: '1948-03-00' }],
    ['coarse date2 before date1', { qualifier: 'between', date1: '1950-06', date2: '1949' }],
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

describe('isFutureDate', () => {
  // 11 Nov 2026, 10:00 UTC: the latest calendar date anywhere (UTC+14) is still the 12th.
  const now = new Date('2026-11-11T10:00:00Z');
  const d = (date1: string, date2?: string) =>
    date2 === undefined
      ? { qualifier: 'exact' as const, date1 }
      : { qualifier: 'between' as const, date1, date2 };

  it('compares each date at its own precision', () => {
    expect(isFutureDate(d('2026'), now)).toBe(false);
    expect(isFutureDate(d('2026-11'), now)).toBe(false);
    expect(isFutureDate(d('2026-11-11'), now)).toBe(false);
    expect(isFutureDate(d('2027'), now)).toBe(true);
    expect(isFutureDate(d('2026-12'), now)).toBe(true);
    expect(isFutureDate(d('2026-11-13'), now)).toBe(true);
  });
  it('allows today in any time zone (UTC+14 is already on the 12th)', () => {
    expect(isFutureDate(d('2026-11-12'), now)).toBe(false);
  });
  it('checks date2 of a range too', () => {
    expect(isFutureDate(d('2020', '2026'), now)).toBe(false);
    expect(isFutureDate(d('2020', '2030'), now)).toBe(true);
  });
});

describe('pastFuzzyDateSchema', () => {
  it('rejects a future date with a fixed message, at the date itself', () => {
    const next = String(new Date().getUTCFullYear() + 1);
    const r = pastFuzzyDateSchema.safeParse({ qualifier: 'exact', date1: next });
    expect(r.success).toBe(false);
    expect(r.error!.issues).toEqual([
      expect.objectContaining({ path: [], message: FUTURE_DATE_MESSAGE }),
    ]);
    expect(FUTURE_DATE_MESSAGE).toBe('That date is in the future');
  });
  it('accepts a past date', () => {
    expect(pastFuzzyDateSchema.safeParse({ qualifier: 'about', date1: '1950' }).success).toBe(true);
  });
});
