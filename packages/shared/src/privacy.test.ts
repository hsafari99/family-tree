import { describe, expect, it } from 'vitest';
import { privacySettingsSchema, stepDistances } from './privacy.js';

/** Unions as [id, partnerA, partnerB] and links as [union, child]. */
function graph(unions: [string, string | null, string | null][], links: [string, string][]) {
  return {
    unions: unions.map(([id, partnerAId, partnerBId]) => ({ id, partnerAId, partnerBId })),
    parentChild: links.map(([unionId, childId], i) => ({ id: `l${i}`, unionId, childId })),
  };
}

// me + wife; wife's parents (wp); her brother; his wife; her parents (bwp); her brother.
const inLaws = graph(
  [
    ['u-me', 'me', 'wife'],
    ['u-wp', 'wf', 'wm'],
    ['u-bro', 'bro', 'bwife'],
    ['u-bwp', 'bwf', 'bwm'],
  ],
  [
    ['u-wp', 'wife'],
    ['u-wp', 'bro'],
    ['u-bwp', 'bwife'],
    ['u-bwp', 'bwbro'],
  ],
);

describe('stepDistances', () => {
  it('counts my wife’s brother’s wife’s brother as 4 steps (spec D5)', () => {
    const d = stepDistances(inLaws, 'me', 10);
    expect(d.get('me')).toBe(0);
    expect(d.get('wife')).toBe(1);
    expect(d.get('bro')).toBe(2);
    expect(d.get('wf')).toBe(2);
    expect(d.get('bwife')).toBe(3);
    expect(d.get('bwbro')).toBe(4);
  });

  it('stops at max', () => {
    const d = stepDistances(inLaws, 'me', 2);
    expect(d.get('bro')).toBe(2);
    expect(d.has('bwife')).toBe(false);
  });

  it('counts half-siblings and parents-unknown siblings as 1 step', () => {
    const g = graph(
      [
        ['u1', 'dad', 'mum1'],
        ['u2', 'dad', 'mum2'],
        ['u3', null, null],
      ],
      [
        ['u1', 'a'],
        ['u2', 'b'],
        ['u3', 'x'],
        ['u3', 'y'],
      ],
    );
    expect(stepDistances(g, 'a', 5).get('b')).toBe(1);
    expect(stepDistances(g, 'x', 5).get('y')).toBe(1);
    expect(stepDistances(g, 'a', 5).has('x')).toBe(false);
  });

  it('makes a first cousin 3 steps away', () => {
    const g = graph(
      [
        ['gp', 'gf', 'gm'],
        ['p1', 'dad', null],
        ['p2', 'aunt', null],
      ],
      [
        ['gp', 'dad'],
        ['gp', 'aunt'],
        ['p1', 'me'],
        ['p2', 'cousin'],
      ],
    );
    expect(stepDistances(g, 'me', 5).get('cousin')).toBe(3);
  });
});

describe('privacySettingsSchema', () => {
  it('needs steps for branch and drops them otherwise', () => {
    expect(
      privacySettingsSchema.safeParse({ level: 'branch', steps: null, hideBirthYear: false })
        .success,
    ).toBe(false);
    expect(privacySettingsSchema.parse({ level: 'public', steps: 3, hideBirthYear: true })).toEqual(
      { level: 'public', steps: null, hideBirthYear: true },
    );
  });
});
