import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  descendantsOf,
  hasCycle,
  type LiveGraph,
  planLinkDeletion,
  planPersonDeletion,
  planUnionDeletion,
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
