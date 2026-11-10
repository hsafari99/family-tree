// @vitest-environment node
import type { TreeGraph } from '@family-tree/shared';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { applyElkLayout, toElkGraph } from './elk-graph';
import { assignGenerations } from './generations';
import { CARD_WIDTH, graphToFlow } from './graph-to-flow';
import { haleGraph } from './test-fixtures';

async function layout(graph: TreeGraph) {
  const flow = graphToFlow(graph, { focusId: null, meId: null });
  const laid = await new ELK().layout(toElkGraph(flow, assignGenerations(flow)));
  const nodes = applyElkLayout(flow.nodes, laid);
  return new Map(nodes.map((n) => [n.id.slice(2), n.position]));
}

describe('ELK layered layout of the seed family', () => {
  it('puts each generation in its own row, in-laws with their partner', async () => {
    const pos = await layout(haleGraph());
    const y = (id: string) => pos.get(id)!.y;
    expect(y('margaret')).toBe(y('robert'));
    for (const id of ['susan', 'anna', 'laura']) expect(y(id)).toBe(y('david'));
    for (const id of ['emma', 'mia', 'noah']) expect(y(id)).toBe(y('leo'));
    expect(y('robert')).toBeLessThan(y('david'));
    expect(y('david')).toBeLessThan(y('leo'));
  });

  it('places each union dot between its partners, below them', async () => {
    const pos = await layout(haleGraph());
    const between = (u: string, a: string, b: string) => {
      const [l, r] = [pos.get(a)!.x, pos.get(b)!.x].sort((m, n) => m - n);
      expect(pos.get(u)!.x).toBeGreaterThanOrEqual(l!);
      expect(pos.get(u)!.x).toBeLessThanOrEqual(r! + CARD_WIDTH);
      expect(pos.get(u)!.y).toBeGreaterThan(pos.get(a)!.y);
    };
    between('u-rm', 'robert', 'margaret');
    between('u-da', 'david', 'anna');
    between('u-dl', 'david', 'laura');
  });

  it('seats a person with two partners between them (spec §6)', async () => {
    const pos = await layout(haleGraph());
    const [a, d, l] = ['anna', 'david', 'laura'].map((id) => pos.get(id)!.x);
    expect((a! < d! && d! < l!) || (l! < d! && d! < a!)).toBe(true);
  });

  it('orders siblings left to right by sibling order', async () => {
    const a = await layout(haleGraph({ leoOrder: 1, miaOrder: 2 }));
    expect(a.get('leo')!.x).toBeLessThan(a.get('mia')!.x);
    const b = await layout(haleGraph({ leoOrder: 2, miaOrder: 1 }));
    expect(b.get('mia')!.x).toBeLessThan(b.get('leo')!.x);
  });
});
