import type { GraphLinkView, GraphPerson, GraphUnionView, TreeGraph } from '@family-tree/shared';

export function gp(
  id: string,
  givenName: string,
  birthYear: number | null,
  extra: Partial<GraphPerson> = {},
): GraphPerson {
  return {
    id,
    givenName,
    middleName: null,
    surname: 'Hale',
    birthYear,
    deathYear: null,
    isLiving: true,
    sex: 'unknown',
    siblingOrder: null,
    hasParents: false,
    hiddenRelatives: false,
    canAddRelative: true,
    photoThumbUrl: null,
    ...extra,
  };
}
export function gu(
  id: string,
  a: string | null,
  b: string | null,
  extra: Partial<GraphUnionView> = {},
): GraphUnionView {
  return {
    id,
    partnerAId: a,
    partnerBId: b,
    type: 'marriage',
    status: 'married',
    startDate: null,
    endDate: null,
    childCount: 0,
    canEdit: true,
    parentsUnknown: false,
    partnerAOrder: null,
    partnerBOrder: null,
    ...extra,
  };
}
export const gl = (
  id: string,
  unionId: string,
  childId: string,
  kind: GraphLinkView['kind'] = 'biological',
): GraphLinkView => ({ id, unionId, childId, kind });

export function haleGraph(o: { leoOrder?: number; miaOrder?: number } = {}): TreeGraph {
  const persons = [
    gp('robert', 'Robert', 1930, { deathYear: 1998, isLiving: false }),
    gp('margaret', 'Margaret', 1932),
    gp('david', 'David', 1956, { hasParents: true }),
    gp('susan', 'Susan', 1959, { hasParents: true }),
    gp('anna', 'Anna', 1958, { surname: 'Berg' }),
    gp('laura', 'Laura', 1965, { surname: 'Chen' }),
    gp('emma', 'Emma', 1985, { hasParents: true }),
    gp('leo', 'Leo', 1994, { hasParents: true, siblingOrder: o.leoOrder ?? null }),
    gp('mia', 'Mia', 1996, { hasParents: true, siblingOrder: o.miaOrder ?? null }),
    gp('noah', 'Noah', 1990, { hasParents: true }),
  ];
  return {
    mode: 'full',
    focusId: null,
    branchId: null,
    total: persons.length,
    truncated: false,
    needsBranch: false,
    persons,
    unions: [
      gu('u-rm', 'robert', 'margaret', { status: 'widowed', childCount: 2 }),
      gu('u-da', 'david', 'anna', { status: 'divorced', childCount: 1 }),
      gu('u-dl', 'david', 'laura', { childCount: 2 }),
      gu('u-s', 'susan', null, { type: 'partnership', status: 'partners', childCount: 1 }),
    ],
    links: [
      gl('l-david', 'u-rm', 'david'),
      gl('l-susan', 'u-rm', 'susan'),
      gl('l-emma', 'u-da', 'emma'),
      gl('l-leo', 'u-dl', 'leo'),
      gl('l-mia', 'u-dl', 'mia', 'adoptive'),
      gl('l-noah', 'u-s', 'noah'),
    ],
  };
}

/** Ann and Ben share a parents-unknown union; Ann has a partner Pat and a child Kim. */
export function unknownParentsGraph(): TreeGraph {
  const persons = [
    gp('ann', 'Ann', 1960),
    gp('ben', 'Ben', 1962),
    gp('pat', 'Pat', 1958),
    gp('kim', 'Kim', 1990, { hasParents: true }),
  ];
  return {
    mode: 'full',
    focusId: null,
    branchId: null,
    total: persons.length,
    truncated: false,
    needsBranch: false,
    persons,
    unions: [
      gu('u0', null, null, {
        parentsUnknown: true,
        type: 'partnership',
        status: 'partners',
        childCount: 2,
      }),
      gu('u-ap', 'ann', 'pat', { childCount: 1 }),
    ],
    links: [gl('l-ann', 'u0', 'ann'), gl('l-ben', 'u0', 'ben'), gl('l-kim', 'u-ap', 'kim')],
  };
}

const fullGraph = (persons: GraphPerson[], unions: GraphUnionView[], links: GraphLinkView[]) => ({
  mode: 'full' as const,
  focusId: null,
  branchId: null,
  persons,
  unions,
  links,
  total: persons.length,
  truncated: false,
  needsBranch: false,
});

/** Paul + Mary → Ann (1950), Ben (1952), Cat (1954). Ben's wife Xan (1949) has no parents and
 *  sorts before every sibling, so model order puts her first in the row (brief #14). */
export function inLawGraph(): TreeGraph {
  return fullGraph(
    [
      gp('paul', 'Paul', 1920),
      gp('mary', 'Mary', 1922),
      gp('ann', 'Ann', 1950, { hasParents: true }),
      gp('ben', 'Ben', 1952, { hasParents: true }),
      gp('cat', 'Cat', 1954, { hasParents: true }),
      gp('xan', 'Xan', 1949, { surname: 'Other' }),
      gp('kid', 'Kid', 1975, { hasParents: true }),
    ],
    [gu('u-pm', 'paul', 'mary', { childCount: 3 }), gu('u-bx', 'ben', 'xan', { childCount: 1 })],
    [
      gl('l1', 'u-pm', 'ann'),
      gl('l2', 'u-pm', 'ben'),
      gl('l3', 'u-pm', 'cat'),
      gl('l4', 'u-bx', 'kid'),
    ],
  );
}

/** Paul + Mary → Ann, Ben. Ben + Xan → Kid; Ann alone → Ali (a single-parent union). Kid's wife Sue
 *  and her brother Sam have unknown parents (u-0). u-0's dot (partition 2·row(Sue)+1) shares a
 *  layer with the row above's dots, u-bx and u-a. */
export function unknownParentsFamilyGraph(): TreeGraph {
  return fullGraph(
    [
      gp('paul', 'Paul', 1920),
      gp('mary', 'Mary', 1922),
      gp('ann', 'Ann', 1950, { hasParents: true }),
      gp('ben', 'Ben', 1952, { hasParents: true }),
      gp('xan', 'Xan', 1953, { surname: 'Other' }),
      gp('ali', 'Ali', 1975, { hasParents: true }),
      gp('kid', 'Kid', 1976, { hasParents: true }),
      gp('sue', 'Sue', 1977, { surname: 'Else', hasParents: true }),
      gp('sam', 'Sam', 1979, { surname: 'Else', hasParents: true }),
    ],
    [
      gu('u-pm', 'paul', 'mary', { childCount: 2 }),
      gu('u-bx', 'ben', 'xan', { childCount: 1 }),
      gu('u-a', 'ann', null, { childCount: 1 }),
      gu('u-0', null, null, { parentsUnknown: true, childCount: 2 }),
      gu('u-ks', 'kid', 'sue'),
    ],
    [
      gl('l1', 'u-pm', 'ann'),
      gl('l2', 'u-pm', 'ben'),
      gl('l3', 'u-bx', 'kid'),
      gl('l4', 'u-a', 'ali'),
      gl('l5', 'u-0', 'sue'),
      gl('l6', 'u-0', 'sam'),
    ],
  );
}
