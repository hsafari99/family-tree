import { relationshipPath } from '@family-tree/shared';
import { describe, expect, it } from 'vitest';
import { graphToFlow } from './graph-to-flow';
import { applyHighlight, pathHighlight } from './highlight';
import { haleGraph, unknownParentsGraph } from './test-fixtures';

const g = haleGraph();
const kin = { persons: g.persons, unions: g.unions, parentChild: g.links };
const flow = graphToFlow(g, { focusId: 'leo', meId: 'leo' });
const steps = (from: string, to: string) => relationshipPath(kin, from, to)!;

describe('pathHighlight', () => {
  it('marks the people, unions and edges from Leo to Emma', () => {
    const h = pathHighlight('leo', steps('leo', 'emma'));
    expect([...h.personIds].sort()).toEqual(['david', 'emma', 'leo']);
    expect([...h.unionIds].sort()).toEqual(['u-da', 'u-dl']);
    expect([...h.edgeIds].sort()).toEqual(
      ['child:l-leo', 'partner:u-dl:david', 'partner:u-da:david', 'child:l-emma'].sort(),
    );
  });

  it('marks both partner edges of a partner step', () => {
    const h = pathHighlight('david', steps('david', 'laura'));
    expect([...h.edgeIds].sort()).toEqual(['partner:u-dl:david', 'partner:u-dl:laura']);
  });
});

describe('applyHighlight', () => {
  it('adds classes to the path, keeping existing ones, and leaves the rest untouched', () => {
    const h = pathHighlight('leo', steps('leo', 'emma'));
    const out = applyHighlight(flow.nodes, flow.edges, h);
    const on = out.nodes.filter((n) => n.className?.includes('is-path'));
    expect(on).toHaveLength(5);
    const edge = out.edges.find((e) => e.id === 'child:l-emma')!;
    expect(edge.className).toBe('edge-child edge-biological edge-path');
    const robert = out.nodes.find((n) => n.id === 'p:robert')!;
    expect(robert).toBe(flow.nodes.find((n) => n.id === 'p:robert'));
    const other = out.edges.find((e) => e.id === 'child:l-noah')!;
    expect(other).toBe(flow.edges.find((e) => e.id === 'child:l-noah'));
  });
});

describe('pathHighlight through a parents-unknown union (brief #11)', () => {
  it('marks the dot and both child edges, but no person for the union', () => {
    const u = unknownParentsGraph();
    const k = { persons: u.persons, unions: u.unions, parentChild: u.links };
    const h = pathHighlight('ann', relationshipPath(k, 'ann', 'ben')!);
    expect([...h.personIds].sort()).toEqual(['ann', 'ben']);
    expect([...h.unionIds]).toEqual(['u0']);
    expect([...h.edgeIds].sort()).toEqual(['child:l-ann', 'child:l-ben']);
  });
});
