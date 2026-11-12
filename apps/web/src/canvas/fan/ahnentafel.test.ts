import type { TreeGraph } from '@family-tree/shared';
import { describe, expect, it } from 'vitest';
import { gl, gp, gu } from '../test-fixtures';
import { ahnentafel, slotGeneration, slotRelation } from './ahnentafel';

const graph = (g: Partial<TreeGraph>): TreeGraph => ({
  mode: 'ancestors',
  focusId: 'me',
  branchId: null,
  total: 0,
  truncated: false,
  needsBranch: false,
  persons: [],
  unions: [],
  links: [],
  ...g,
});

describe('ahnentafel', () => {
  it('numbers a full line: 1 the person, 2n the father, 2n+1 the mother', () => {
    const g = graph({
      persons: [
        gp('me', 'Me', 1990),
        gp('mum', 'Mum', 1960, { sex: 'female' }),
        gp('dad', 'Dad', 1958, { sex: 'male' }),
        gp('gf', 'Gf', 1930, { sex: 'male' }),
        gp('gm', 'Gm', 1932, { sex: 'female' }),
      ],
      // Mum is partner A: the sex, not the slot, decides.
      unions: [gu('u1', 'mum', 'dad'), gu('u2', 'gm', 'gf')],
      links: [gl('l1', 'u1', 'me'), gl('l2', 'u2', 'mum')],
    });
    expect([...ahnentafel(g, 'me', 3)].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 'me'],
      [2, 'dad'],
      [3, 'mum'],
      [6, 'gf'],
      [7, 'gm'],
    ]);
  });
  it('without sexes, partner A is 2n and B is 2n+1; a lone parent goes by sex', () => {
    const g = graph({
      persons: [
        gp('me', 'Me', 1990),
        gp('a', 'A', 1960),
        gp('b', 'B', 1960),
        gp('m', 'M', 1930, { sex: 'female' }),
      ],
      unions: [gu('u1', 'a', 'b'), gu('u2', 'm', null)],
      links: [gl('l1', 'u1', 'me'), gl('l2', 'u2', 'a')],
    });
    const n = ahnentafel(g, 'me', 3);
    expect([n.get(2), n.get(3), n.get(5), n.get(4)]).toEqual(['a', 'b', 'm', undefined]);
  });
  it('stops at the generation limit, prefers birth parents, ignores parents-unknown unions', () => {
    const g = graph({
      persons: [
        gp('me', 'Me', 1990),
        gp('step', 'S', 1960, { sex: 'male' }),
        gp('dad', 'D', 1960, { sex: 'male' }),
        gp('gp', 'G', 1930, { sex: 'male' }),
        gp('sib', 'Sib', 1992),
      ],
      unions: [
        gu('u0', null, null, { parentsUnknown: true }),
        gu('us', 'step', null),
        gu('ud', 'dad', null),
        gu('ug', 'gp', null),
      ],
      links: [
        gl('l0', 'u0', 'me'),
        gl('ls', 'us', 'me', 'step'),
        gl('ld', 'ud', 'me'),
        gl('lg', 'ug', 'dad'),
      ],
    });
    expect(ahnentafel(g, 'me', 2).get(2)).toBe('dad');
    expect(ahnentafel(g, 'me', 1).has(4)).toBe(false);
    expect(ahnentafel(g, 'me', 2).get(4)).toBe('gp');
  });
});

describe('slots', () => {
  it('knows each slot’s generation and relation', () => {
    expect([1, 2, 3, 4, 7, 8, 15, 16, 127].map(slotGeneration)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 6,
    ]);
    expect(slotRelation(2, 'male')).toBe('Father');
    expect(slotRelation(3, 'unknown')).toBe('Parent');
    expect(slotRelation(5, 'female')).toBe('Grandmother, father’s side');
    expect(slotRelation(12, 'male')).toBe('Great-grandfather, mother’s side');
    expect(slotRelation(20, 'unknown')).toBe('2× great-grandparent, father’s side');
  });
});
