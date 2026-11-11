import type { FamilyGraph } from './branch.js';

export interface BranchCase {
  name: string;
  /** Person keys are short names; the int test maps them to real uuids. */
  graph: FamilyGraph;
  anchor: string;
  steward: string | null;
  expected: string[];
}

/**
 * The Hale family, the same shape as the dev seed (rows created by 'u1' marked):
 *   robert + margaret → david, susan
 *   david + anna (divorced) → emma
 *   david + laura → leo, mia (adoptive)
 *   susan + (unknown) → noah
 *   laura's parents: george + helen → laura
 *   leo + zoe (zoe has no parents recorded)
 *   kim: unconnected, created by u1
 */
const hale: FamilyGraph = {
  persons: [
    'robert',
    'margaret',
    'david',
    'susan',
    'anna',
    'laura',
    'emma',
    'leo',
    'mia',
    'noah',
    'george',
    'helen',
    'zoe',
  ]
    .map((id) => ({ id, createdBy: null as string | null }))
    .concat([{ id: 'kim', createdBy: 'u1' }]),
  unions: [
    { id: 'u_rm', partnerAId: 'robert', partnerBId: 'margaret' },
    { id: 'u_da', partnerAId: 'david', partnerBId: 'anna' },
    { id: 'u_dl', partnerAId: 'david', partnerBId: 'laura' },
    { id: 'u_s', partnerAId: 'susan', partnerBId: null },
    { id: 'u_gh', partnerAId: 'george', partnerBId: 'helen' },
    { id: 'u_lz', partnerAId: 'leo', partnerBId: 'zoe' },
  ],
  parentChild: [
    { unionId: 'u_rm', childId: 'david' },
    { unionId: 'u_rm', childId: 'susan' },
    { unionId: 'u_da', childId: 'emma' },
    { unionId: 'u_dl', childId: 'leo' },
    { unionId: 'u_dl', childId: 'mia' },
    { unionId: 'u_s', childId: 'noah' },
    { unionId: 'u_gh', childId: 'laura' },
  ],
};

const HALE_SIDE = [
  'robert',
  'margaret',
  'david',
  'susan',
  'anna',
  'emma',
  'leo',
  'mia',
  'noah',
  'zoe',
];

export const BRANCH_CASES: BranchCase[] = [
  {
    name: 'anchor on a grandchild covers both parents’ sides (all ancestors count)',
    graph: hale,
    anchor: 'leo',
    steward: null,
    // Leo's ancestors are David, Laura, Robert, Margaret, George and Helen; everyone except
    // Kim (unconnected) descends from or partners with them.
    expected: [...HALE_SIDE, 'laura', 'george', 'helen'],
  },
  {
    name: 'anchor on Laura covers her parents side and her own descendants',
    graph: hale,
    anchor: 'laura',
    steward: null,
    // Laura, her parents, their descendants (Laura, Leo, Mia), and partners without parents:
    // David has parents (excluded), Zoe has none (included).
    expected: ['laura', 'george', 'helen', 'leo', 'mia', 'zoe'],
  },
  {
    name: 'anchor at the top covers everyone below plus parentless partners, not Laura (she has parents)',
    graph: hale,
    anchor: 'robert',
    steward: null,
    expected: HALE_SIDE,
  },
  {
    name: 'a partner without parents is included, but their own other relatives are not',
    graph: hale,
    anchor: 'anna',
    steward: null,
    // Anna has no parents: her ancestors are just Anna; descendants: Emma. Partner David has
    // parents, so he is excluded.
    expected: ['anna', 'emma'],
  },
  {
    name: 'people the steward created are always included',
    graph: hale,
    anchor: 'anna',
    steward: 'u1',
    expected: ['anna', 'emma', 'kim'],
  },
  {
    name: 'an unknown anchor yields only created people',
    graph: hale,
    anchor: 'nobody',
    steward: 'u1',
    expected: ['kim'],
  },
  {
    name: 'siblings with unknown parents share a branch; a partner with recorded siblings is on their own side',
    graph: {
      persons: ['ann', 'ben', 'cal', 'dee', 'eve'].map((id) => ({ id, createdBy: null })),
      unions: [
        { id: 'u0', partnerAId: null, partnerBId: null, parentsUnknown: true },
        { id: 'u_bc', partnerAId: 'ben', partnerBId: 'cal' },
        { id: 'u_ad', partnerAId: 'ann', partnerBId: 'dee' },
        { id: 'u1', partnerAId: null, partnerBId: null, parentsUnknown: true },
      ],
      parentChild: [
        { unionId: 'u0', childId: 'ann' },
        { unionId: 'u0', childId: 'ben' },
        { unionId: 'u1', childId: 'dee' },
        { unionId: 'u1', childId: 'eve' },
      ],
    },
    anchor: 'ann',
    steward: null,
    // Dee has recorded siblings, so Dee is on her own side (rule 3).
    expected: ['ann', 'ben', 'cal'],
  },
];
