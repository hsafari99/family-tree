import { describe, expect, it } from 'vitest';
import { editDistance, findSimilar, normalizeName, type SimilarCandidate } from './similar.js';

const c = (
  id: string,
  givenName: string,
  extra: Partial<SimilarCandidate> = {},
): SimilarCandidate => ({
  id,
  givenName,
  middleName: null,
  surname: 'Lovelace',
  maidenName: null,
  nickname: null,
  birthYear: null,
  deathYear: null,
  isLiving: true,
  ...extra,
});

describe('normalizeName', () => {
  it('lower-cases, strips accents and collapses spaces', () => {
    expect(normalizeName('  Zoë   ÅSE ')).toBe('zoe ase');
  });
});

describe('editDistance', () => {
  it('counts edits and stops early past the limit', () => {
    expect(editDistance('kitten', 'sitting', 5)).toBe(3);
    expect(editDistance('ada', 'ada', 1)).toBe(0);
    expect(editDistance('abcdef', 'uvwxyz', 1)).toBe(2); // capped at limit + 1
  });
});

describe('findSimilar', () => {
  const people = [
    c('exact', 'Ada', { birthYear: 1815 }),
    c('typo', 'Adah', { birthYear: 1816 }),
    c('far-year', 'Ada', { birthYear: 1830 }),
    c('no-year', 'Ada'),
    c('other-surname', 'Ada', { surname: 'Byron', birthYear: 1815 }),
    c('maiden', 'Ada', { surname: 'King', maidenName: 'Lovelace', birthYear: 1815 }),
    c('nick', 'Augusta', { nickname: 'Ada', birthYear: 1815 }),
    c('other', 'Charles', { birthYear: 1815 }),
  ];
  it('matches close first names, last or maiden names and years within 2', () => {
    const ids = findSimilar(
      people,
      { givenName: 'Ada', surname: 'Lovelace', birthYear: 1815 },
      10,
    ).map((p) => p.id);
    expect(ids.slice(0, 3).sort()).toEqual(['exact', 'maiden', 'nick']);
    expect(ids).toContain('typo');
    expect(ids).toContain('no-year');
    expect(ids).not.toContain('far-year');
    expect(ids).not.toContain('other-surname');
    expect(ids).not.toContain('other');
  });
  it('ignores accents and case, and limits the result', () => {
    const list = [c('zoe', 'Zoë', { surname: 'Ångström' })];
    expect(findSimilar(list, { givenName: 'zoe', surname: 'angstrom' }, 5)).toHaveLength(1);
    expect(findSimilar(people, { givenName: 'Ada' }, 2)).toHaveLength(2);
  });
  it('treats a short prefix with care: "Al" does not match "Alexander"', () => {
    expect(findSimilar([c('x', 'Alexander')], { givenName: 'Al' }, 5)).toHaveLength(0);
    expect(findSimilar([c('x', 'Alexander')], { givenName: 'Alex' }, 5)).toHaveLength(1);
  });
});
