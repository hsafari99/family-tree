import { describe, expect, it } from 'vitest';
import type { LiveGraph } from './family-graph.js';
import {
  connectedTo,
  kinIndex,
  neighbourhood,
  visibleRelations,
  withHiddenRelatives,
} from './graph-view.js';

const P = [
  'gp',
  'gm',
  'pa',
  'ma',
  'olive',
  'sis',
  'step',
  'half',
  'sam',
  'kid',
  'kp',
  'gk',
  'lone',
];
const graph: LiveGraph = {
  persons: P.map((id) => ({ id })),
  unions: [
    { id: 'u-gp', partnerAId: 'gp', partnerBId: 'gm' },
    { id: 'u-pa', partnerAId: 'pa', partnerBId: 'ma' },
    { id: 'u-step', partnerAId: 'ma', partnerBId: 'step' },
    { id: 'u-olive', partnerAId: 'olive', partnerBId: 'sam' },
    { id: 'u-kid', partnerAId: 'kid', partnerBId: 'kp' },
  ],
  parentChild: [
    { id: 'l-pa', unionId: 'u-gp', childId: 'pa' },
    { id: 'l-olive', unionId: 'u-pa', childId: 'olive' },
    { id: 'l-sis', unionId: 'u-pa', childId: 'sis' },
    { id: 'l-half', unionId: 'u-step', childId: 'half' },
    { id: 'l-kid', unionId: 'u-olive', childId: 'kid' },
    { id: 'l-gk', unionId: 'u-kid', childId: 'gk' },
  ],
};
const sorted = (s: Iterable<string>) => [...s].sort();

describe('neighbourhood', () => {
  const kin = kinIndex(graph);
  it('depth 1 is parents, siblings, partners and children (spec §6)', () => {
    expect(sorted(neighbourhood(kin, 'olive', 1, 500).ids)).toEqual(
      sorted(['olive', 'pa', 'ma', 'sis', 'sam', 'kid']),
    );
  });
  it('depth 2 adds grandparents, step-parent, half-sibling, in-law and grandchild', () => {
    expect(sorted(neighbourhood(kin, 'olive', 2, 500).ids)).toEqual(
      sorted(['olive', 'pa', 'ma', 'sis', 'sam', 'kid', 'gp', 'gm', 'step', 'half', 'kp', 'gk']),
    );
  });
  it('never reaches someone with no relations', () => {
    expect(neighbourhood(kin, 'olive', 3, 500).ids.has('lone')).toBe(false);
  });
  it('stops at the limit, nearest first, and says so', () => {
    const n = neighbourhood(kin, 'olive', 3, 4);
    expect(n.ids.size).toBe(4);
    expect(n.truncated).toBe(true);
    expect(n.ids.has('olive')).toBe(true);
    expect([...n.ids].every((id) => ['olive', 'pa', 'ma', 'sis', 'sam', 'kid'].includes(id))).toBe(
      true,
    );
  });
  it('can be limited to a set (branch view)', () => {
    const within = new Set(['sam', 'kid', 'kp', 'gk']);
    expect(sorted(neighbourhood(kin, 'sam', Infinity, 2000, within).ids)).toEqual(sorted(within));
  });
});

describe('connectedTo', () => {
  it('is everyone reachable from the root through any relation', () => {
    const c = connectedTo(kinIndex(graph), 'olive');
    expect(c.size).toBe(12);
    expect(c.has('lone')).toBe(false);
  });
  it('is empty without a root', () => {
    expect(connectedTo(kinIndex(graph), null).size).toBe(0);
  });
});

describe('visibleRelations', () => {
  it('draws unions with both partners shown, or a partner and a child shown (decision 3)', () => {
    const ids = neighbourhood(kinIndex(graph), 'olive', 1, 500).ids;
    const { unionIds, linkIds } = visibleRelations(graph, ids);
    expect(sorted(unionIds)).toEqual(['u-olive', 'u-pa']);
    expect(sorted(linkIds)).toEqual(['l-kid', 'l-olive', 'l-sis']);
  });
  it('keeps a single-parent union when its child is shown', () => {
    const g: LiveGraph = {
      persons: [{ id: 'mum' }, { id: 'kid' }],
      unions: [{ id: 'u', partnerAId: 'mum', partnerBId: null }],
      parentChild: [{ id: 'l', unionId: 'u', childId: 'kid' }],
    };
    expect(sorted(visibleRelations(g, new Set(['mum', 'kid'])).unionIds)).toEqual(['u']);
    expect(visibleRelations(g, new Set(['mum'])).unionIds.size).toBe(0);
  });
});

describe('withHiddenRelatives', () => {
  it('marks people with a close relative outside the view', () => {
    const kin = kinIndex(graph);
    const ids = neighbourhood(kin, 'olive', 1, 500).ids;
    expect(sorted(withHiddenRelatives(kin, ids))).toEqual(['kid', 'ma', 'pa']);
  });
});

describe('visibleRelations with parents-unknown unions (brief #11)', () => {
  it('shows a parents-unknown union when one of its children is shown', () => {
    const sibs: LiveGraph = {
      persons: [{ id: 'ann' }, { id: 'ben' }],
      unions: [{ id: 'u0', partnerAId: null, partnerBId: null, parentsUnknown: true }],
      parentChild: [
        { id: 'l1', unionId: 'u0', childId: 'ann' },
        { id: 'l2', unionId: 'u0', childId: 'ben' },
      ],
    };
    expect(visibleRelations(sibs, new Set(['ann', 'ben'])).unionIds).toEqual(new Set(['u0']));
    expect(visibleRelations(sibs, new Set(['ann'])).linkIds).toEqual(new Set(['l1']));
    expect(kinIndex(sibs).get('ann')).toEqual(new Set(['ben']));
  });
});
