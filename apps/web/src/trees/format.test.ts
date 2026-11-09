import { describe, expect, it } from 'vitest';
import { fakePerson } from '../test/fake-trees';
import { parseYear, personName, personYears } from './format';

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
