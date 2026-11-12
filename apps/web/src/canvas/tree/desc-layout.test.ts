import type { TreeGraph } from '@family-tree/shared';
import { describe, expect, it } from 'vitest';
import { gl, gp, gu } from '../test-fixtures';
import { descLayout, GEN_GAP, SLOT } from './desc-layout';

// Robert and Margaret: David (with Anna: Emma; with Laura: Leo, Mia) and Susan (Noah).
const graph: TreeGraph = {
  mode: 'descendants',
  focusId: 'robert',
  branchId: null,
  total: 10,
  truncated: false,
  needsBranch: false,
  persons: [
    gp('robert', 'Robert', 1930),
    gp('margaret', 'Margaret', 1932),
    gp('david', 'David', 1956),
    gp('anna', 'Anna', 1958),
    gp('laura', 'Laura', 1965),
    gp('susan', 'Susan', 1959),
    gp('emma', 'Emma', 1985),
    gp('leo', 'Leo', 1994),
    gp('mia', 'Mia', 1996),
    gp('noah', 'Noah', 1990),
  ],
  unions: [
    gu('u-rm', 'robert', 'margaret'),
    gu('u-da', 'david', 'anna', { partnerAOrder: 1 }),
    gu('u-dl', 'david', 'laura', { partnerAOrder: 2 }),
    gu('u-s', 'susan', null),
  ],
  links: [
    gl('l1', 'u-rm', 'david'),
    gl('l2', 'u-rm', 'susan'),
    gl('l3', 'u-da', 'emma'),
    gl('l4', 'u-dl', 'leo'),
    gl('l5', 'u-dl', 'mia'),
    gl('l6', 'u-s', 'noah'),
  ],
};
const at = (l: ReturnType<typeof descLayout>, id: string) =>
  l.nodes.find((n) => n.personId === id)!;

describe('descLayout', () => {
  const l = descLayout(graph, 'robert', 4);
  it('puts the root at the bottom and each generation one step higher', () => {
    expect(at(l, 'robert').gen).toBe(0);
    expect(at(l, 'robert').y).toBeGreaterThan(at(l, 'david').y);
    expect(at(l, 'david').y - at(l, 'leo').y).toBe(GEN_GAP);
    expect(at(l, 'david').y).toBe(at(l, 'susan').y);
  });
  it('centres a parent over their children', () => {
    expect(at(l, 'robert').x).toBe((at(l, 'david').x + at(l, 'susan').x) / 2);
    expect(at(l, 'susan').x).toBe(at(l, 'noah').x);
  });
  it('spaces the leaves without overlap, and groups children by union in union order', () => {
    const leaves = ['emma', 'leo', 'mia', 'noah'].map((id) => at(l, id).x);
    for (let i = 1; i < leaves.length; i++)
      expect(leaves[i]! - leaves[i - 1]!).toBeGreaterThanOrEqual(SLOT);
    expect(at(l, 'david').partners.map((p) => p.id)).toEqual(['anna', 'laura']);
    expect(at(l, 'margaret')).toBeUndefined(); // a partner, not a node
    expect(at(l, 'robert').partners.map((p) => p.id)).toEqual(['margaret']);
  });
  it('lists the branches and fits the drawing', () => {
    expect(l.branches).toContainEqual({ from: 'david', to: 'leo', gen: 1 });
    expect(l.branches).toHaveLength(6);
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(l.width);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(l.height);
    }
  });
  it('stops at the generation limit', () => {
    const one = descLayout(graph, 'robert', 1);
    expect(one.nodes.map((n) => n.personId).sort()).toEqual(['david', 'robert', 'susan']);
  });
});
