import { describe, expect, it } from 'vitest';
import { fakePerson } from '../test/fake-trees';
import {
  formatBytes,
  formatFuzzyDate,
  initials,
  parseYear,
  personName,
  personYears,
} from './format';

describe('personName', () => {
  it('joins given, middle and surname, skipping blanks', () => {
    expect(
      personName(fakePerson({ givenName: 'Ada', middleName: 'King', surname: 'Lovelace' })),
    ).toBe('Ada King Lovelace');
    expect(personName(fakePerson({ givenName: 'Ada', middleName: null, surname: null }))).toBe(
      'Ada',
    );
  });
});

describe('personYears', () => {
  it('formats ranges, births only, and nothing', () => {
    expect(personYears(fakePerson({ birthYear: 1930, deathYear: 1998, isLiving: false }))).toBe(
      '1930–1998',
    );
    expect(personYears(fakePerson({ birthYear: 1990, deathYear: null, isLiving: true }))).toBe(
      'b. 1990',
    );
    expect(personYears(fakePerson({ birthYear: null, deathYear: null }))).toBe('');
  });
});

describe('parseYear', () => {
  it('is undefined for blank and NaN for anything that is not a finite number', () => {
    expect(parseYear('  ')).toBeUndefined();
    expect(parseYear(' 1990 ')).toBe(1990);
    expect(parseYear('abc')).toBeNaN();
    expect(parseYear('1e999')).toBeNaN();
  });
});

describe('formatFuzzyDate', () => {
  it('formats fuzzy dates in English', () => {
    expect(formatFuzzyDate(null)).toBe('');
    expect(formatFuzzyDate({ qualifier: 'exact', date1: '1950' })).toBe('1950');
    expect(formatFuzzyDate({ qualifier: 'about', date1: '1950-03' })).toBe('about March 1950');
    expect(formatFuzzyDate({ qualifier: 'exact', date1: '1950-03-07' })).toBe('7 March 1950');
    expect(formatFuzzyDate({ qualifier: 'before', date1: '0950' })).toBe('before 950');
    expect(formatFuzzyDate({ qualifier: 'between', date1: '1950', date2: '1955' })).toBe(
      'between 1950 and 1955',
    );
  });
});

describe('initials', () => {
  it('takes the first letters of given name and surname, upper-cased', () => {
    expect(initials({ givenName: 'ada', middleName: null, surname: 'lovelace' })).toBe('AL');
    expect(initials({ givenName: 'Zoë', middleName: null, surname: null })).toBe('Z');
    expect(initials({ givenName: '😀x', middleName: null, surname: null })).toBe('😀');
  });
});

describe('formatBytes', () => {
  it('uses binary math with KB/MB/GB labels', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(950)).toBe('950 B');
    expect(formatBytes(12_345)).toBe('12.1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1_073_741_824)).toBe('1 GB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
  });
  it('rounds before choosing the unit', () => {
    expect(formatBytes(999_999)).toBe('977 KB');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1 MB');
  });
});
