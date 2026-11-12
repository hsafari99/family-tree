import { describe, expect, it } from 'vitest';
import { collapseGraph } from './collapse';
import { haleGraph, inLawGraph, unknownParentsFamilyGraph, gl, gp, gu } from './test-fixtures';

const ids = (g: { persons: { id: string }[] }) => g.persons.map((p) => p.id).sort();

describe('collapseGraph', () => {
  it('changes nothing with no collapsed person', () => {
    const g = haleGraph();
    const r = collapseGraph(g, new Set(), 'robert');
    expect(r.graph).toBe(g);
    expect(r.hiddenCount.size).toBe(0);
  });

  it('hides a collapsed person’s descendants and their partners', () => {
    // Robert + Margaret → David, Susan; David + Anna → Emma; David + Laura → Leo, Mia; Susan → Noah.
    const r = collapseGraph(haleGraph(), new Set(['david']), 'robert');
    expect(ids(r.graph)).toEqual(['anna', 'david', 'laura', 'margaret', 'noah', 'robert', 'susan']);
    // David's partners stay: they are his partners, not his descendants.
    expect(r.hiddenCount.get('david')).toBe(3);
    // Links and unions that lost an end are gone from the graph.
    expect(r.graph.links.map((l) => l.id).sort()).toEqual(['l-david', 'l-noah', 'l-susan']);
  });

  it('hides a descendant’s in-laws that hang only from the branch', () => {
    // Ben collapsed: Kid, Kid's wife Sue, and Sue's brother Sam (parents unknown) all go.
    const r = collapseGraph(unknownParentsFamilyGraph(), new Set(['ben']), 'paul');
    expect(ids(r.graph)).toEqual(['ali', 'ann', 'ben', 'mary', 'paul', 'xan']);
    expect(r.hiddenCount.get('ben')).toBe(3);
  });

  it('keeps a descendant who is also reachable through a parent who isn’t collapsed', () => {
    // Paul + Mary → Ann; Ann + Bob → Kid. Bob's parents Gus + Gem are in the tree too.
    const g = {
      ...inLawGraph(),
      persons: [
        gp('paul', 'Paul', 1920),
        gp('mary', 'Mary', 1922),
        gp('gus', 'Gus', 1921),
        gp('gem', 'Gem', 1923),
        gp('ann', 'Ann', 1950),
        gp('bob', 'Bob', 1949),
        gp('kid', 'Kid', 1975),
      ],
      unions: [gu('u-pm', 'paul', 'mary'), gu('u-gg', 'gus', 'gem'), gu('u-ab', 'ann', 'bob')],
      links: [gl('l1', 'u-pm', 'ann'), gl('l2', 'u-gg', 'bob'), gl('l3', 'u-ab', 'kid')],
    };
    // Gus is in the tree through his son Bob, Paul's son-in-law: collapsing Paul alone would hide
    // Gus's family too, but collapsing Gus keeps Kid (through Ann, Paul's daughter).
    const r = collapseGraph(g, new Set(['gus']), 'paul');
    expect(ids(r.graph)).toEqual(['ann', 'bob', 'gem', 'gus', 'kid', 'mary', 'paul']);
    expect(r.hiddenCount.get('gus')).toBe(0);
  });

  it('nested collapses: the outer one counts everyone it hides', () => {
    const both = collapseGraph(haleGraph(), new Set(['robert', 'david']), 'robert');
    expect(ids(both.graph)).toEqual(['margaret', 'robert']);
    expect(both.hiddenCount.get('robert')).toBe(8);
    // Expanding the outer one leaves the inner one collapsed.
    const inner = collapseGraph(haleGraph(), new Set(['david']), 'robert');
    expect(inner.graph.persons).toHaveLength(7);
  });

  it('never hides the focus person', () => {
    // Focus on Leo, with his grandfather collapsed: Leo's line up stays, his aunt's family goes.
    const g = { ...haleGraph(), mode: 'focus' as const, focusId: 'leo' };
    const r = collapseGraph(g, new Set(['robert']), 'leo');
    expect(r.graph.persons.some((p) => p.id === 'leo')).toBe(true);
    expect(r.graph.persons.some((p) => p.id === 'noah')).toBe(false);
    // The focus person collapsed: their own descendants hide, they stay.
    const self = collapseGraph(haleGraph(), new Set(['david']), 'david');
    expect(ids(self.graph)).toContain('david');
    expect(ids(self.graph)).not.toContain('emma');
  });

  it('ignores unknown ids', () => {
    const g = haleGraph();
    const r = collapseGraph(g, new Set(['nobody']), 'robert');
    expect(r.graph.persons).toHaveLength(g.persons.length);
    expect(r.hiddenCount.has('nobody')).toBe(false);
  });

  it('says which collapsed people hide each hidden person', () => {
    const r = collapseGraph(haleGraph(), new Set(['robert', 'david']), 'robert');
    expect(r.hiddenBy.get('leo')?.sort()).toEqual(['david', 'robert']);
    expect(r.hiddenBy.get('noah')).toEqual(['robert']);
  });
});
