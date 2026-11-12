import { describe, expect, it } from 'vitest';
import { fakePerson } from '../test/fake-trees';
import {
  countPeople,
  formatBytes,
  formatFuzzyDate,
  formatValue,
  initials,
  lifeStatus,
  personName,
  personYears,
  timeAgo,
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

describe('lifeStatus', () => {
  it('says living or deceased, with the death date in words', () => {
    expect(lifeStatus(true, null)).toBe('Living');
    expect(lifeStatus(false, null)).toBe('Deceased (date unknown)');
    expect(lifeStatus(false, { qualifier: 'exact', date1: '1998-05-03' })).toBe(
      'Deceased on 3 May 1998',
    );
    expect(lifeStatus(false, { qualifier: 'exact', date1: '1998-05' })).toBe(
      'Deceased in May 1998',
    );
    expect(lifeStatus(false, { qualifier: 'exact', date1: '1998' })).toBe('Deceased in 1998');
    expect(lifeStatus(false, { qualifier: 'about', date1: '1998' })).toBe('Deceased about 1998');
    expect(lifeStatus(false, { qualifier: 'before', date1: '1998' })).toBe('Deceased before 1998');
    expect(lifeStatus(false, { qualifier: 'after', date1: '1998-05-03' })).toBe(
      'Deceased after 3 May 1998',
    );
    expect(lifeStatus(false, { qualifier: 'between', date1: '1990', date2: '1998' })).toBe(
      'Deceased between 1990 and 1998',
    );
  });

  it('History names the field Status, with Living or Deceased as its values', () => {
    expect(formatValue(true, 'isLiving')).toBe('Living');
    expect(formatValue(false, 'isLiving')).toBe('Deceased');
    expect(formatValue(true)).toBe('Yes');
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

describe('timeAgo', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');
  const ago = (ms: number) => timeAgo(new Date(now.getTime() - ms).toISOString(), now);
  it('says "just now" under a minute, then minutes, hours and days', () => {
    expect(ago(10_000)).toBe('just now');
    expect(ago(5 * 60_000)).toBe('5 minutes ago');
    expect(ago(60 * 60_000)).toBe('1 hour ago');
    expect(ago(3 * 3_600_000)).toBe('3 hours ago');
    expect(ago(24 * 3_600_000)).toBe('yesterday');
    expect(ago(6 * 86_400_000)).toBe('6 days ago');
  });
  it('gives a date after a week, and treats a future time as now', () => {
    expect(ago(30 * 86_400_000)).toBe(new Date('2026-10-12T12:00:00.000Z').toLocaleDateString());
    expect(ago(-60_000)).toBe('just now');
  });
});

describe('countPeople', () => {
  it('says person or people', () => {
    expect(countPeople(0)).toBe('0 people');
    expect(countPeople(1)).toBe('1 person');
    expect(countPeople(12)).toBe('12 people');
  });
});
