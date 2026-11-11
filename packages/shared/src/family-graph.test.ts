import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  descendantsOf,
  hasCycle,
  type LiveGraph,
  planLinkDeletion,
  planPersonDeletion,
  planUnionDeletion,
  unionEnds,
  wouldCycle,
} from './family-graph.js';

/**
 *   grandpa + grandma (u1) → dad
 *   mgp + (none) (u4) → mum
 *   dad + mum (u2) → kid1, kid2
 *   dad + (none) (u5) → halfkid
 *   kid1 + spouse (u3) → grandkid          spouse: no parents, no other union
 *   kid2 + partner2 (u6); partner2 + outsider (u7)
 */
const g: LiveGraph = {
  persons: [
    'grandpa',
    'grandma',
    'mgp',
    'dad',
    'mum',
    'kid1',
    'kid2',
    'halfkid',
    'spouse',
    'grandkid',
    'partner2',
    'outsider',
  ].map((id) => ({ id })),
  unions: [
    { id: 'u1', partnerAId: 'grandpa', partnerBId: 'grandma' },
    { id: 'u2', partnerAId: 'dad', partnerBId: 'mum' },
    { id: 'u3', partnerAId: 'kid1', partnerBId: 'spouse' },
    { id: 'u4', partnerAId: 'mgp', partnerBId: null },
    { id: 'u5', partnerAId: 'dad', partnerBId: null },
    { id: 'u6', partnerAId: 'kid2', partnerBId: 'partner2' },
    { id: 'u7', partnerAId: 'partner2', partnerBId: 'outsider' },
  ],
  parentChild: [
    { id: 'l-dad', unionId: 'u1', childId: 'dad' },
    { id: 'l-mum', unionId: 'u4', childId: 'mum' },
    { id: 'l-kid1', unionId: 'u2', childId: 'kid1' },
    { id: 'l-kid2', unionId: 'u2', childId: 'kid2' },
    { id: 'l-half', unionId: 'u5', childId: 'halfkid' },
    { id: 'l-gk', unionId: 'u3', childId: 'grandkid' },
  ],
};
const sorted = (xs: Iterable<string>) => [...xs].sort();

describe('walks', () => {
  it('finds ancestors and descendants, including the start', () => {
    expect(sorted(ancestorsOf(g, 'grandkid'))).toEqual(
      sorted(['grandkid', 'kid1', 'spouse', 'dad', 'mum', 'grandpa', 'grandma', 'mgp']),
    );
    expect(sorted(descendantsOf(g, 'dad'))).toEqual(
      sorted(['dad', 'kid1', 'kid2', 'halfkid', 'grandkid']),
    );
  });
  it('detects a link that would make someone their own ancestor', () => {
    expect(wouldCycle(g, ['kid1'], ['dad'])).toBe(true);
    expect(wouldCycle(g, ['dad'], ['dad'])).toBe(true);
    expect(wouldCycle(g, ['mum'], ['grandkid'])).toBe(false);
    expect(wouldCycle(g, ['new-person'], ['dad'])).toBe(false);
  });
  it('detects an existing cycle', () => {
    expect(hasCycle(g)).toBe(false);
    const looped: LiveGraph = {
      ...g,
      unions: [...g.unions, { id: 'u9', partnerAId: 'grandkid', partnerBId: null }],
      parentChild: [...g.parentChild, { id: 'l-loop', unionId: 'u9', childId: 'dad' }],
    };
    expect(hasCycle(looped)).toBe(true);
  });
});

describe('planPersonDeletion, just this person', () => {
  it('empties their slot where a partner survives and removes unions left without one', () => {
    const p = planPersonDeletion(g, 'dad', 'person');
    expect(p.personIds).toEqual(['dad']);
    expect(p.slots).toEqual([{ unionId: 'u2', slot: 'a', personId: 'dad' }]);
    expect(p.unionIds).toEqual(['u5']);
    expect(sorted(p.parentChildIds)).toEqual(['l-dad', 'l-half']);
    expect(sorted(p.touchedPersonIds)).toEqual(
      sorted(['dad', 'mum', 'grandpa', 'grandma', 'kid1', 'kid2', 'halfkid']),
    );
  });
  it('keeps the union and children with the surviving partner', () => {
    const p = planPersonDeletion(g, 'grandma', 'person');
    expect(p.slots).toEqual([{ unionId: 'u1', slot: 'b', personId: 'grandma' }]);
    expect(p.unionIds).toEqual([]);
    expect(p.parentChildIds).toEqual([]);
    expect(sorted(p.touchedPersonIds)).toEqual(sorted(['grandma', 'grandpa', 'dad']));
  });
});

describe('planPersonDeletion, with descendants', () => {
  it('takes descendants and partners with no other connection', () => {
    const p = planPersonDeletion(g, 'dad', 'descendants');
    expect(p.personIds[0]).toBe('dad');
    expect(sorted(p.personIds)).toEqual(
      sorted(['dad', 'kid1', 'kid2', 'halfkid', 'grandkid', 'spouse']),
    );
    expect(sorted(p.unionIds)).toEqual(['u3', 'u5']);
    expect(p.slots).toEqual([
      { unionId: 'u2', slot: 'a', personId: 'dad' },
      { unionId: 'u6', slot: 'a', personId: 'kid2' },
    ]);
    expect(sorted(p.parentChildIds)).toEqual(
      sorted(['l-dad', 'l-kid1', 'l-kid2', 'l-gk', 'l-half']),
    );
    expect(p.touchedPersonIds).toContain('partner2');
    expect(p.touchedPersonIds).not.toContain('outsider');
  });
});

describe('planPersonDeletion, descendants mode partners', () => {
  it('keeps the root’s own partner but removes a descendant’s lone partner', () => {
    const p = planPersonDeletion(g, 'kid1', 'descendants');
    expect(sorted(p.personIds)).toEqual(['grandkid', 'kid1']);
    expect(p.personIds).not.toContain('spouse');
    expect(p.slots).toEqual([{ unionId: 'u3', slot: 'a', personId: 'kid1' }]);
  });
  const small = (extraUnions: LiveGraph['unions']): LiveGraph => ({
    persons: ['r', 'c', 'x', 'y'].map((id) => ({ id })),
    unions: [
      { id: 'ur', partnerAId: 'r', partnerBId: null },
      { id: 'uc', partnerAId: 'c', partnerBId: 'x' },
      ...extraUnions,
    ],
    parentChild: [{ id: 'l', unionId: 'ur', childId: 'c' }],
  });
  it('keeps a descendant’s partner who also has a single-parent union', () => {
    const p = planPersonDeletion(
      small([{ id: 'ux', partnerAId: 'x', partnerBId: null }]),
      'r',
      'descendants',
    );
    expect(sorted(p.personIds)).toEqual(['c', 'r']);
  });
  it('removes a partner whose unions are all with deleted people', () => {
    const graph: LiveGraph = {
      persons: ['r', 'c', 'c2', 'x'].map((id) => ({ id })),
      unions: [
        { id: 'ur', partnerAId: 'r', partnerBId: null },
        { id: 'uc', partnerAId: 'c', partnerBId: 'x' },
        { id: 'ux', partnerAId: 'x', partnerBId: 'c2' },
      ],
      parentChild: [
        { id: 'l1', unionId: 'ur', childId: 'c' },
        { id: 'l2', unionId: 'ur', childId: 'c2' },
      ],
    };
    const p = planPersonDeletion(graph, 'r', 'descendants');
    expect(sorted(p.personIds)).toEqual(['c', 'c2', 'r', 'x']);
  });
});

describe('relation plans', () => {
  it('a union takes its child links with it', () => {
    const p = planUnionDeletion(g, 'u2');
    expect(p).toMatchObject({ personIds: [], unionIds: ['u2'], slots: [] });
    expect(sorted(p.parentChildIds)).toEqual(['l-kid1', 'l-kid2']);
    expect(sorted(p.touchedPersonIds)).toEqual(sorted(['dad', 'mum', 'kid1', 'kid2']));
  });
  it('a link touches the child and every parent', () => {
    const p = planLinkDeletion(g, 'l-kid1');
    expect(p).toMatchObject({ personIds: [], unionIds: [], parentChildIds: ['l-kid1'] });
    expect(sorted(p.touchedPersonIds)).toEqual(sorted(['kid1', 'dad', 'mum']));
  });
});

describe('parents-unknown unions (brief #11)', () => {
  const sibs: LiveGraph = {
    persons: [{ id: 'ann' }, { id: 'ben' }, { id: 'pat' }],
    unions: [{ id: 'u0', partnerAId: null, partnerBId: null, parentsUnknown: true }],
    parentChild: [
      { id: 'l1', unionId: 'u0', childId: 'ann' },
      { id: 'l2', unionId: 'u0', childId: 'ben' },
    ],
  };
  const one: LiveGraph = { ...sibs, parentChild: [sibs.parentChild[0]!] };

  it('deleting one sibling keeps the parents-unknown union for the other', () => {
    const plan = planPersonDeletion(sibs, 'ann', 'person');
    expect(plan.unionIds).toEqual([]);
    expect(plan.parentChildIds).toEqual(['l1']);
  });
  it('deleting the last child removes the parents-unknown union too', () => {
    expect(planPersonDeletion(one, 'ann', 'person').unionIds).toEqual(['u0']);
  });
  it('removing the last child link removes the parents-unknown union with it', () => {
    expect(planLinkDeletion(one, 'l1')).toMatchObject({ unionIds: ['u0'], parentChildIds: ['l1'] });
    // another child still holds it
    expect(planLinkDeletion(sibs, 'l1').unionIds).toEqual([]);
    // once a parent fills a slot it is an ordinary single-parent union and stays
    const filled = { ...one, unions: [{ ...sibs.unions[0]!, partnerAId: 'pat' }] };
    expect(planLinkDeletion(filled, 'l1').unionIds).toEqual([]);
  });
  it('deleting a parents-unknown union takes all its child links and touches the children', () => {
    const plan = planUnionDeletion(sibs, 'u0');
    expect(plan.parentChildIds).toEqual(['l1', 'l2']);
    expect(plan.touchedPersonIds).toEqual(['ann', 'ben']);
  });
  it('a parent added later and then deleted leaves the siblings together', () => {
    const filled = { ...sibs, unions: [{ ...sibs.unions[0]!, partnerAId: 'pat' }] };
    const plan = planPersonDeletion(filled, 'pat', 'person');
    expect(plan.unionIds).toEqual([]);
    expect(plan.slots).toEqual([{ unionId: 'u0', slot: 'a', personId: 'pat' }]);
  });
  it('gives a partnerless union its children as can() ends', () => {
    expect(unionEnds(sibs.unions[0]!, ['ann', 'ben'])).toEqual(['ann', 'ben']);
    expect(unionEnds({ id: 'x', partnerAId: 'pat', partnerBId: null }, ['ann'])).toEqual(['pat']);
  });
});
