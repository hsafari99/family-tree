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
    ...extra,
  };
}
const gl = (
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
