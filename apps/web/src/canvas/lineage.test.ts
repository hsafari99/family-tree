import { describe, expect, it } from 'vitest';
import type { Family } from './graph-to-flow';
import { applyLineage, lineage } from './lineage';
import { graphToFlow } from './graph-to-flow';
import { haleGraph } from './test-fixtures';

const fam = (id: string, partnerIds: string[], childIds: string[]): Family => ({
  id,
  partnerIds,
  childIds,
  childLinks: childIds.map((c) => ({ childId: c, linkId: `l-${c}` })),
});
// gpa + gma -> pa, aunt; pa + ma -> me, sis; me + spouse -> kid; kid alone -> grandkid.
const FAMILIES = [
  fam('g', ['gpa', 'gma'], ['pa', 'aunt']),
  fam('p', ['pa', 'ma'], ['me', 'sis']),
  fam('m', ['me', 'spouse'], ['kid']),
  fam('k', ['kid'], ['grandkid']),
];
const sorted = (s: ReadonlySet<string>) => [...s].sort();

describe('lineage', () => {
  it('follows the chain up through the parents and down through the children', () => {
    const h = lineage(FAMILIES, 'me');
    expect(sorted(h.personIds)).toEqual(['gma', 'gpa', 'grandkid', 'kid', 'ma', 'me', 'pa']);
    expect(sorted(h.unionIds)).toEqual(['g', 'k', 'm', 'p']);
    expect(sorted(h.edgeIds)).toEqual(
      [
        'child:l-pa',
        'partner:g:gpa',
        'partner:g:gma',
        'child:l-me',
        'partner:p:pa',
        'partner:p:ma',
        'partner:m:me',
        'child:l-kid',
        'partner:k:kid',
        'child:l-grandkid',
      ].sort(),
    );
  });

  it('leaves siblings and aunts off the line', () => {
    const h = lineage(FAMILIES, 'me');
    expect(h.personIds.has('sis')).toBe(false);
    expect(h.personIds.has('aunt')).toBe(false);
    expect(h.edgeIds.has('child:l-sis')).toBe(false);
  });

  it('leaves a partner off the line, but not the union they share', () => {
    const h = lineage(FAMILIES, 'me');
    expect(h.personIds.has('spouse')).toBe(false);
    expect(h.edgeIds.has('partner:m:spouse')).toBe(false);
    expect(h.unionIds.has('m')).toBe(true);
  });

  it('stops at a parents-unknown union', () => {
    const h = lineage([fam('u', [], ['a', 'b'])], 'a');
    expect(sorted(h.personIds)).toEqual(['a']);
    expect(sorted(h.unionIds)).toEqual(['u']);
    expect(sorted(h.edgeIds)).toEqual(['child:l-a']);
  });

  it('is safe on cycles', () => {
    const h = lineage([fam('x', ['a'], ['b']), fam('y', ['b'], ['a'])], 'a');
    expect(sorted(h.personIds)).toEqual(['a', 'b']);
  });

  it('is just the person when they have no family on screen', () => {
    expect(sorted(lineage(FAMILIES, 'stranger').personIds)).toEqual(['stranger']);
  });
});

describe('applyLineage', () => {
  it('marks the line and dims everything else, nodes and edges', () => {
    const flow = graphToFlow(haleGraph(), { focusId: null, meId: null });
    const h = lineage(flow.families, 'leo');
    const { nodes, edges } = applyLineage(flow.nodes, flow.edges, h);
    const cls = (id: string) => nodes.find((n) => n.id === id)!.className ?? '';
    expect(cls('p:leo')).toMatch(/\bis-line\b/);
    expect(cls('p:david')).toMatch(/\bis-line\b/);
    expect(cls('p:mia')).toMatch(/\bis-dim\b/);
    expect(cls('u:u-dl')).toMatch(/\bis-line\b/);
    const ecls = (id: string) => edges.find((e) => e.id === id)!.className ?? '';
    expect(ecls('child:l-leo')).toMatch(/\bedge-line\b/);
    expect(ecls('child:l-leo')).toMatch(/\bedge-child\b/);
    expect(edges.filter((e) => /edge-dim/.test(e.className ?? '')).length).toBeGreaterThan(0);
  });

  it('records the link of each shown child in the families', () => {
    const flow = graphToFlow(haleGraph(), { focusId: null, meId: null });
    const dl = flow.families.find((f) => f.id === 'u-dl')!;
    expect(dl.childLinks).toContainEqual({ childId: 'leo', linkId: 'l-leo' });
  });
});
