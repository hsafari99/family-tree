import { describe, expect, it } from 'vitest';
import {
  closeRelativeSteps,
  hourglassGenerations,
  type KinGraph,
  kinPathsFrom,
  kinshipChain,
  kinshipTerm,
  nth,
  relationshipPath,
} from './kinship.js';
import type { ChildKind, UnionStatus, UnionType } from './people.js';
import type { Sex } from './trees.js';

function family() {
  const g = {
    persons: [] as { id: string; sex: Sex }[],
    unions: [] as KinGraph['unions'][number][],
    parentChild: [] as KinGraph['parentChild'][number][],
  };
  let n = 0;
  const people = (map: Record<string, Sex>) => {
    for (const [id, sex] of Object.entries(map)) g.persons.push({ id, sex });
  };
  const union = (
    id: string,
    a: string | null,
    b: string | null,
    kids: (string | [string, ChildKind])[] = [],
    type: UnionType = 'marriage',
    status: UnionStatus = 'married',
  ) => {
    g.unions.push({ id, partnerAId: a, partnerBId: b, type, status });
    for (const k of kids) {
      const [childId, kind] = Array.isArray(k) ? k : [k, 'biological' as const];
      g.parentChild.push({ id: `l${++n}`, unionId: id, childId, kind });
    }
  };
  return { g, people, union };
}

// "me" is a woman; her father's family has two generations above, her husband's family one.
const { g, people, union } = family();
people({
  stepKid: 'male',
  ggp: 'male',
  gp: 'male',
  gm: 'female',
  gpBro: 'male',
  pc: 'female',
  sc: 'male',
  scKid: 'female',
  dad: 'male',
  mum: 'female',
  aunt: 'female',
  auntHus: 'male',
  cousin: 'male',
  cw: 'female',
  cKid: 'female',
  me: 'female',
  sis: 'female',
  sisHus: 'male',
  niece: 'female',
  nx: 'unknown',
  gniece: 'female',
  ex: 'female',
  halfBro: 'male',
  hbKid: 'male',
  hus: 'male',
  hf: 'male',
  hm: 'female',
  hsis: 'female',
  hsx: 'other',
  son: 'male',
  dil: 'female',
  grandson: 'male',
  kid2: 'unknown',
  foster: 'male',
  stepdad: 'male',
  sw: 'female',
  stepsis: 'female',
  lone: 'male',
});
union('U_gg', 'ggp', null, ['gp', 'gpBro']);
union('U_gb', 'gpBro', null, ['pc']);
union('U_pc', 'pc', null, ['sc']);
union('U_sc', 'sc', null, ['scKid']);
union('U_g', 'gp', 'gm', ['dad', 'aunt']);
union('U_au', 'aunt', 'auntHus', ['cousin']);
union('U_c', 'cousin', 'cw', ['cKid']);
union('U_dm', 'dad', 'mum', ['me', 'sis', ['stepKid', 'step']]);
union('U_dx', 'dad', 'ex', ['halfBro'], 'marriage', 'divorced');
union('U_hb', 'halfBro', null, ['hbKid']);
union('U_sh', 'sis', 'sisHus', ['niece']);
union('U_nx', 'niece', 'nx', ['gniece'], 'partnership', 'partners');
union('U_mh', 'me', 'hus', ['son', ['kid2', 'adoptive'], ['foster', 'foster']]);
union('U_h', 'hf', 'hm', ['hus', 'hsis']);
union('U_hs', 'hsis', 'hsx', [], 'partnership', 'separated');
union('U_sd', 'son', 'dil', ['grandson']);
union('U_ms', 'mum', 'stepdad', [], 'partnership', 'partners');
union('U_ss', 'stepdad', 'sw', ['stepsis']);

const fromMe = kinPathsFrom(g, 'me');

describe('kinship from "me"', () => {
  it.each([
    ['dad', 'father', 'your father'],
    ['sis', 'sister', 'your sister'],
    ['halfBro', 'half-brother', 'your half-brother'],
    ['gp', 'grandfather', 'your father’s father'],
    ['ggp', 'great-grandfather', 'your father’s father’s father'],
    ['aunt', 'aunt', 'your father’s sister'],
    ['auntHus', 'uncle by marriage', 'your father’s sister’s husband'], // spec §6's example
    ['cousin', 'first cousin', 'your father’s sister’s son'],
    ['cKid', 'first cousin once removed', 'your father’s sister’s son’s daughter'],
    ['gpBro', 'great-uncle', 'your father’s father’s brother'],
    ['sc', 'second cousin', 'your father’s father’s brother’s daughter’s son'],
    [
      'scKid',
      'second cousin once removed',
      'your father’s father’s brother’s daughter’s son’s daughter',
    ],
    ['niece', 'niece', 'your sister’s daughter'],
    ['gniece', 'great-niece', 'your sister’s daughter’s daughter'],
    ['nx', null, 'your sister’s daughter’s partner'],
    ['sisHus', 'brother-in-law', 'your sister’s husband'],
    ['hus', 'husband', 'your husband'],
    ['hm', 'mother-in-law', 'your husband’s mother'],
    ['hsis', 'sister-in-law', 'your husband’s sister'],
    ['hsx', null, 'your husband’s sister’s former partner'],
    ['son', 'son', 'your son'],
    ['kid2', 'adopted child', 'your adopted child'],
    ['foster', 'foster son', 'your foster son'],
    ['dil', 'daughter-in-law', 'your son’s wife'],
    ['grandson', 'grandson', 'your son’s son'],
    ['stepdad', 'stepfather', 'your mother’s partner'],
    ['stepsis', 'stepsister', 'your mother’s partner’s daughter'],
    ['ex', 'former stepmother', 'your father’s former wife'],
    ['stepKid', 'stepbrother', 'your stepbrother'],
  ])('%s is my %s', (to, term, chain) => {
    const steps = fromMe(to)!;
    expect(kinshipTerm(steps)).toBe(term);
    expect(kinshipChain(steps, 'your')).toBe(chain);
  });

  it('finds no path to an unconnected person, and an empty one to myself', () => {
    expect(fromMe('lone')).toBeNull();
    expect(fromMe('me')).toEqual([]);
    expect(kinshipTerm([])).toBeNull();
  });
});

describe('kinship in other directions', () => {
  it.each([
    ['halfBro', 'me', 'half-sister'],
    ['cKid', 'me', 'first cousin once removed'],
    ['ex', 'me', 'former stepdaughter'],
    ['grandson', 'dad', 'great-grandfather'],
    ['sc', 'dad', 'first cousin once removed'],
    ['son', 'auntHus', 'great-uncle by marriage'],
    ['niece', 'hbKid', 'half first cousin'],
    ['hbKid', 'sis', 'half-aunt'],
  ])('%s → %s is %s', (from, to, term) => {
    expect(kinshipTerm(relationshipPath(g, from, to)!)).toBe(term);
  });

  it('words the chain from someone else’s side', () => {
    expect(kinshipChain(relationshipPath(g, 'son', 'auntHus')!, 'Leo’s')).toBe(
      'Leo’s mother’s father’s sister’s husband',
    );
  });

  it('uses neutral words for other or unknown sex, and numbered greats beyond two', () => {
    const { g: line, people: ps, union: u } = family();
    ps({ a0: 'unknown', a1: 'male', a2: 'unknown', a3: 'male', a4: 'unknown', a5: 'male' });
    for (let i = 1; i <= 5; i++) u(`x${i}`, `a${i}`, null, [`a${i - 1}`]);
    expect(kinshipTerm(relationshipPath(line, 'a0', 'a5')!)).toBe('3rd great-grandfather');
    expect(kinshipTerm(relationshipPath(line, 'a5', 'a0')!)).toBe('3rd great-grandchild');
    expect(kinshipTerm(relationshipPath(line, 'a3', 'a2')!)).toBe('child');
    expect(kinshipTerm(fromMe('nx')!.slice(0, 3))).toBe('niece'); // the path prefix still words
  });

  it('prefers the shorter path, and blood over marriage at equal length', () => {
    const { g: t, people: ps, union: u } = family();
    ps({ g1: 'male', a: 'male', b: 'male', x: 'female', y: 'male', z: 'female' });
    // x and z are first cousins (UUDD, 4 steps) through g1, and z is also x's brother's wife (UDP, 3).
    u('G', 'g1', null, ['a', 'b']);
    u('A', 'a', null, ['x', 'y']);
    u('B', 'b', null, ['z']);
    u('YZ', 'y', 'z');
    expect(kinshipTerm(relationshipPath(t, 'x', 'z')!)).toBe('sister-in-law');
    // y and z: partners (1 step) beats first cousins (4).
    expect(kinshipTerm(relationshipPath(t, 'y', 'z')!)).toBe('wife');
  });

  it('formats ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 111].map(nth).join(' ')).toBe(
      '1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 111th',
    );
  });
});

describe('the path itself', () => {
  it('is a shortest path, deterministic, with union and link ids', () => {
    const steps = fromMe('cousin')!;
    expect(steps.map((s) => s.move)).toEqual(['parent', 'parent', 'child', 'child']);
    expect(steps.map((s) => s.personId)).toEqual(['dad', 'gm', 'aunt', 'cousin']); // gm sorts before gp
    expect(steps[0]).toMatchObject({ unionId: 'U_dm', kind: 'biological', unionType: null });
    expect(fromMe('hus')![0]).toMatchObject({
      move: 'partner',
      unionId: 'U_mh',
      linkId: null,
      unionType: 'marriage',
      unionStatus: 'married',
    });
    expect(relationshipPath(g, 'me', 'cousin')).toEqual(steps);
  });

  it('ignores links to people or unions that are not in the graph', () => {
    const { g: h, people: ps, union: u } = family();
    ps({ a: 'male', b: 'female' });
    u('U', 'a', 'ghost', ['b']);
    expect(relationshipPath(h, 'b', 'a')!.map((s) => s.personId)).toEqual(['a']);
    expect(relationshipPath(h, 'a', 'ghost')).toBeNull();
  });

  it('counts close-relative steps like the focus view (half-siblings are two)', () => {
    expect(closeRelativeSteps(fromMe('sis')!)).toBe(1);
    expect(closeRelativeSteps(fromMe('halfBro')!)).toBe(2);
    expect(closeRelativeSteps(fromMe('auntHus')!)).toBe(3);
    expect(closeRelativeSteps(fromMe('scKid')!)).toBe(6);
  });
});

describe('hourglassGenerations', () => {
  const gens = (to: string) => hourglassGenerations(fromMe(to)!);
  it('counts generations up or down the line, with the person’s own row at 1', () => {
    expect(hourglassGenerations([])).toBe(1);
    expect(['sis', 'halfBro', 'hus', 'dad', 'son', 'dil'].map(gens)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(['gp', 'ggp', 'grandson'].map(gens)).toEqual([2, 3, 2]);
  });
  it('is null for anyone off the line', () => {
    for (const to of [
      'aunt',
      'auntHus',
      'cousin',
      'niece',
      'hbKid',
      'hf',
      'hsis',
      'stepdad',
      'stepsis',
    ])
      expect(gens(to), to).toBeNull();
  });
});

describe('step links inside longer blood patterns', () => {
  const steps = (build: (f: ReturnType<typeof family>) => void, to: string) => {
    const f = family();
    build(f);
    return kinPathsFrom(f.g, 'me')(to)!;
  };

  it('UU through a stepfather link is not a plain grandfather', () => {
    const s = steps((f) => {
      f.people({ me: 'male', sp: 'male', gp: 'male' });
      f.union('U1', 'sp', null, [['me', 'step']]);
      f.union('U2', 'gp', null, ['sp']);
    }, 'gp');
    expect(kinshipTerm(s)).toBeNull();
    expect(kinshipChain(s, 'your')).toBe('your stepfather’s father');
  });

  it('UUD through a step link is not a plain uncle', () => {
    const s = steps((f) => {
      f.people({ me: 'male', sp: 'male', gp: 'male', unc: 'male' });
      f.union('U1', 'sp', null, [['me', 'step']]);
      f.union('U2', 'gp', null, ['sp', 'unc']);
    }, 'unc');
    expect(kinshipTerm(s)).toBeNull();
  });

  it('DD with a step first link is not a plain grandson', () => {
    const s = steps((f) => {
      f.people({ me: 'male', sk: 'male', gk: 'male' });
      f.union('U1', 'me', null, [['sk', 'step']]);
      f.union('U2', 'sk', null, ['gk']);
    }, 'gk');
    expect(kinshipTerm(s)).toBeNull();
  });
});

describe('siblings with unknown parents (brief #11)', () => {
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const U = '00000000-0000-4000-8000-0000000000a1';
  const L1 = '00000000-0000-4000-8000-0000000000b1';
  const L2 = '00000000-0000-4000-8000-0000000000b2';
  it('are brother and sister through a virtual parent step', () => {
    const g: KinGraph = {
      persons: [
        { id: A, sex: 'male' },
        { id: B, sex: 'female' },
      ],
      unions: [
        {
          id: U,
          partnerAId: null,
          partnerBId: null,
          type: 'partnership',
          status: 'partners',
          parentsUnknown: true,
        },
      ],
      parentChild: [
        { id: L1, unionId: U, childId: A, kind: 'biological' },
        { id: L2, unionId: U, childId: B, kind: 'biological' },
      ],
    };
    const steps = relationshipPath(g, A, B)!;
    expect(steps.map((s) => s.move)).toEqual(['parent', 'child']);
    expect(steps.map((s) => s.virtual)).toEqual([true, undefined]);
    expect(steps[0]!.personId).toBe(U);
    expect(kinshipTerm(steps)).toBe('sister');
    expect(kinshipTerm(relationshipPath(g, B, A)!)).toBe('brother');
  });
});
