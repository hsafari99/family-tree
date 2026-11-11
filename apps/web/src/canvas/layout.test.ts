// @vitest-environment node
import type { TreeGraph } from '@family-tree/shared';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { applyElkLayout, toElkGraph } from './elk-graph';
import { assignGenerations } from './generations';
import { CARD_WIDTH, graphToFlow, UNION_SIZE } from './graph-to-flow';
import {
  haleGraph,
  inLawGraph,
  unknownParentsFamilyGraph,
  unknownParentsGraph,
} from './test-fixtures';

/** The laid-out nodes, with width and height. */
async function layoutNodes(graph: TreeGraph) {
  const flow = graphToFlow(graph, { focusId: null, meId: null });
  const laid = await new ELK().layout(toElkGraph(flow, assignGenerations(flow)));
  return applyElkLayout(flow.nodes, laid, flow.couples, flow.blood);
}
/** Positions keyed by person or union id. */
async function layout(graph: TreeGraph) {
  return new Map((await layoutNodes(graph)).map((n) => [n.id.slice(2), n.position]));
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

  it('puts siblings with unknown parents in one row, under their dot (brief #11)', async () => {
    const pos = await layout(unknownParentsGraph());
    expect(pos.get('ben')!.y).toBe(pos.get('ann')!.y);
    expect(pos.get('u0')!.y).toBeLessThan(pos.get('ann')!.y);
    expect(pos.get('kim')!.y).toBeGreaterThan(pos.get('ann')!.y);
  });
});

describe('couples in the layout (brief #14)', () => {
  const GRAPHS = () => [
    inLawGraph(),
    haleGraph(),
    unknownParentsFamilyGraph(),
    unknownParentsGraph(),
  ];
  /** People in a's row strictly between a and b. */
  const between = (
    g: TreeGraph,
    pos: Map<string, { x: number; y: number }>,
    a: string,
    b: string,
  ) => {
    const [l, r] = [pos.get(a)!.x, pos.get(b)!.x].sort((m, n) => m - n);
    return g.persons
      .map((p) => p.id)
      .filter((id) => id !== a && id !== b)
      .filter(
        (id) => pos.get(id)!.y === pos.get(a)!.y && pos.get(id)!.x > l! && pos.get(id)!.x < r!,
      );
  };

  it('keeps partners next to each other', async () => {
    for (const g of GRAPHS()) {
      const pos = await layout(g);
      for (const u of g.unions) {
        if (!u.partnerAId || !u.partnerBId) continue;
        expect(between(g, pos, u.partnerAId, u.partnerBId), u.id).toEqual([]);
      }
    }
  });

  it('keeps sibling order between couple groups', async () => {
    const pos = await layout(inLawGraph());
    expect(pos.get('ann')!.x).toBeLessThan(pos.get('ben')!.x);
    expect(pos.get('ben')!.x).toBeLessThan(pos.get('cat')!.x);
  });

  it("puts each couple's dot between the two partners", async () => {
    for (const g of GRAPHS()) {
      const pos = await layout(g);
      for (const u of g.unions) {
        if (!u.partnerAId || !u.partnerBId) continue;
        const [l, r] = [pos.get(u.partnerAId)!.x, pos.get(u.partnerBId)!.x].sort((m, n) => m - n);
        const dot = pos.get(u.id)!.x + UNION_SIZE / 2;
        expect(dot, u.id).toBeGreaterThan(l! + CARD_WIDTH / 2);
        expect(dot, u.id).toBeLessThan(r! + CARD_WIDTH / 2);
      }
    }
  });

  it('never overlaps two nodes', async () => {
    for (const g of GRAPHS()) {
      const laid = await layoutNodes(g);
      for (const [i, m] of laid.entries())
        for (const n of laid.slice(i + 1)) {
          const apart =
            m.position.x + m.width! <= n.position.x ||
            n.position.x + n.width! <= m.position.x ||
            m.position.y + m.height! <= n.position.y ||
            n.position.y + n.height! <= m.position.y;
          expect(apart, `${m.id} / ${n.id}`).toBe(true);
        }
    }
  });

  it('puts a one-partner dot under its partner and a parents-unknown dot over its children', async () => {
    const pos = await layout(unknownParentsFamilyGraph());
    const card = (id: string) => pos.get(id)!.x + CARD_WIDTH / 2;
    const dot = (id: string) => pos.get(id)!.x + UNION_SIZE / 2;
    expect(Math.abs(dot('u-a') - card('ann'))).toBeLessThan(CARD_WIDTH / 2);
    const [l, r] = [card('sue'), card('sam')].sort((m, n) => m - n);
    expect(dot('u-0')).toBeGreaterThan(l! - CARD_WIDTH / 2);
    expect(dot('u-0')).toBeLessThan(r! + CARD_WIDTH / 2);
    expect(pos.get('u-0')!.y).toBeLessThan(pos.get('sue')!.y);
  });
});
