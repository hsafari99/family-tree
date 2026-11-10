import { describe, expect, it } from 'vitest';
import { applyElkLayout, toElkGraph } from './elk-graph';
import { assignGenerations } from './generations';
import { CARD_HEIGHT, CARD_WIDTH, graphToFlow } from './graph-to-flow';
import { haleGraph } from './test-fixtures';

const flow = () => graphToFlow(haleGraph(), { focusId: null, meId: null });
const part = (g: ReturnType<typeof toElkGraph>, id: string) =>
  g.children!.find((c) => c.id === id)!.layoutOptions?.['elk.partitioning.partition'];

describe('toElkGraph', () => {
  it('sets layered/DOWN/partitioning, one partition per row, sizes and edges', () => {
    const f = flow();
    const g = toElkGraph(f, assignGenerations(f));
    expect(g.layoutOptions).toMatchObject({
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.partitioning.activate': 'true',
    });
    expect(part(g, 'p:robert')).toBe('0');
    expect(part(g, 'u:u-rm')).toBe('1');
    expect(part(g, 'p:david')).toBe('2');
    expect(part(g, 'p:anna')).toBe('2');
    expect(part(g, 'u:u-dl')).toBe('3');
    expect(part(g, 'p:leo')).toBe('4');
    const card = g.children!.find((c) => c.id === 'p:robert')!;
    expect([card.width, card.height]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
    expect(g.edges![0]).toEqual({
      id: f.edges[0]!.id,
      sources: [f.edges[0]!.source],
      targets: [f.edges[0]!.target],
    });
  });

  it('has no partitioning without rows', () => {
    const g = toElkGraph(flow(), null);
    expect(g.layoutOptions).not.toHaveProperty('elk.partitioning.activate');
    expect(g.children!.every((c) => c.layoutOptions === undefined)).toBe(true);
  });
});

describe('applyElkLayout', () => {
  it('sets positions on laid-out nodes and leaves the rest', () => {
    const f = flow();
    const out = applyElkLayout(f.nodes, {
      id: 'root',
      children: [{ id: 'p:robert', x: 10, y: 20 }],
    });
    expect(out.find((n) => n.id === 'p:robert')!.position).toEqual({ x: 10, y: 20 });
    expect(out.find((n) => n.id === 'p:leo')!.position).toEqual({ x: 0, y: 0 });
  });

  it('sorts by (y, x) for reading order, without touching the ELK input order', () => {
    const f = flow();
    const before = toElkGraph(f, null).children!.map((c) => c.id);
    const laid = {
      id: 'root',
      children: f.nodes.map((n) => ({
        id: n.id,
        x: n.id === 'p:mia' ? 0 : n.id === 'p:leo' ? 200 : n.id === 'p:robert' ? 100 : 5000,
        y: n.id === 'p:mia' || n.id === 'p:leo' ? 300 : n.id === 'p:robert' ? 0 : 9000,
      })),
    };
    const out = applyElkLayout(f.nodes, laid).map((n) => n.id);
    expect(out.slice(0, 3)).toEqual(['p:robert', 'p:mia', 'p:leo']);
    expect(toElkGraph(f, null).children!.map((c) => c.id)).toEqual(before);
  });
});

describe('applyElkLayout union dots', () => {
  it('centres a union dot horizontally between its two shown partners', () => {
    const f = flow();
    const union = f.nodes.find((n) => n.id === 'u:u-rm')!;
    if (union.type !== 'union') throw new Error('fixture');
    const [a, b] = [union.data.union.partnerAId, union.data.union.partnerBId].map(
      (id) => `p:${id}`,
    );
    const laid = { id: 'root', children: f.nodes.map((n) => ({ id: n.id, x: 50, y: 0 })) };
    laid.children.find((c) => c.id === a)!.x = 0;
    laid.children.find((c) => c.id === b)!.x = 400;
    const dot = applyElkLayout(f.nodes, laid).find((n) => n.id === 'u:u-rm')!;
    expect(dot.position.x + 12).toBe((CARD_WIDTH / 2 + 400 + CARD_WIDTH / 2) / 2);
  });
});
