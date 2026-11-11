import type { TreeGraph } from '@family-tree/shared';
import { describe, expect, it } from 'vitest';
import { applyElkLayout, placeUnionDots, toElkGraph } from './elk-graph';
import { assignGenerations } from './generations';
import { CARD_HEIGHT, CARD_WIDTH, graphToFlow, UNION_SIZE } from './graph-to-flow';
import { gl, gp, gu, haleGraph, unknownParentsGraph } from './test-fixtures';

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
    expect(part(g, 'p:robert')).toBe('2');
    expect(part(g, 'u:u-rm')).toBe('3');
    expect(part(g, 'p:david')).toBe('4');
    expect(part(g, 'p:anna')).toBe('4');
    expect(part(g, 'u:u-dl')).toBe('5');
    expect(part(g, 'p:leo')).toBe('6');
    const card = g.children!.find((c) => c.id === 'p:robert')!;
    expect([card.width, card.height]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
    expect(g.edges![0]).toEqual({
      id: f.edges[0]!.id,
      sources: [f.edges[0]!.source],
      targets: [f.edges[0]!.target],
    });
  });

  it('puts a parents-unknown dot just above its children, never negative (brief #11)', () => {
    const f = graphToFlow(unknownParentsGraph(), { focusId: null, meId: null });
    const g = toElkGraph(f, assignGenerations(f));
    expect(part(g, 'p:ann')).toBe('2');
    expect(part(g, 'p:ben')).toBe('2');
    expect(part(g, 'u:u0')).toBe('1');
    expect(part(g, 'u:u-ap')).toBe('3');
    expect(part(g, 'p:kim')).toBe('4');
    for (const c of g.children!) {
      const p = Number(c.layoutOptions?.['elk.partitioning.partition']);
      expect(Number.isInteger(p) && p >= 0).toBe(true);
    }
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
    // Every other node far away in its own row, so nothing is nudged.
    const laid = {
      id: 'root',
      children: f.nodes.map((n, i) => ({ id: n.id, x: 50, y: 1000 + i * 200 })),
    };
    Object.assign(
      laid.children.find((c) => c.id === a)!,
      { x: 0, y: 0 },
    );
    Object.assign(
      laid.children.find((c) => c.id === b)!,
      { x: 400, y: 0 },
    );
    laid.children.find((c) => c.id === 'u:u-rm')!.y = 100;
    const dot = applyElkLayout(f.nodes, laid).find((n) => n.id === 'u:u-rm')!;
    expect(dot.position.x + 12).toBe((CARD_WIDTH / 2 + 400 + CARD_WIDTH / 2) / 2);
  });
});

describe('placeUnionDots', () => {
  const GAP = 32;
  const STEP = UNION_SIZE + GAP / 2;
  /** Lays the flow out by hand: each [id, x, y]; edges come from the flow. */
  const setup = (graph: TreeGraph, at: [string, number, number][]) => {
    const f = graphToFlow(graph, { focusId: null, meId: null });
    const laidOut = {
      id: 'root',
      children: at.map(([id, x, y]) => ({ id, x, y })),
      edges: f.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    };
    const pos = new Map(at.map(([id, x, y]) => [id, { x, y }]));
    return { f, laidOut, pos };
  };
  const mid = (pos: Map<string, { x: number }>, id: string) => pos.get(id)!.x + UNION_SIZE / 2;
  const card = (pos: Map<string, { x: number }>, id: string) => pos.get(id)!.x + CARD_WIDTH / 2;

  it("centres a one-partner dot under its partner's new place", () => {
    const g = haleGraph();
    const { f, laidOut, pos } = setup(g, [
      ['p:susan', 200, 0],
      ['p:noah', 200, 200],
      ['u:u-s', 0, 100],
    ]);
    pos.set('p:susan', { x: 300, y: 0 }); // seatCouples moved her by +100
    placeUnionDots(f.nodes, laidOut, pos, GAP);
    expect(mid(pos, 'u:u-s')).toBe(300 + CARD_WIDTH / 2);
  });

  it('fans out two one-partner dots of one person, a step apart', () => {
    const g: TreeGraph = {
      ...haleGraph(),
      persons: [
        gp('ann', 'Ann', 1950),
        gp('k1', 'K', 1970, { hasParents: true }),
        gp('k2', 'L', 1972, { hasParents: true }),
      ],
      unions: [gu('u1', 'ann', null, { childCount: 1 }), gu('u2', 'ann', null, { childCount: 1 })],
      links: [gl('l1', 'u1', 'k1'), gl('l2', 'u2', 'k2')],
    };
    const { f, laidOut, pos } = setup(g, [
      ['p:ann', 100, 0],
      ['p:k1', 0, 200],
      ['p:k2', 300, 200],
      ['u:u1', 0, 100],
      ['u:u2', 0, 100],
    ]);
    placeUnionDots(f.nodes, laidOut, pos, GAP);
    expect(mid(pos, 'u:u2') - mid(pos, 'u:u1')).toBe(STEP);
    expect((mid(pos, 'u:u1') + mid(pos, 'u:u2')) / 2).toBe(card(pos, 'p:ann'));
  });

  it("puts a parents-unknown dot at the mean of its children's centres", () => {
    const { f, laidOut, pos } = setup(unknownParentsGraph(), [
      ['p:ann', 0, 100],
      ['p:ben', 400, 100],
      ['u:u0', 900, 0],
    ]);
    placeUnionDots(f.nodes, laidOut, pos, GAP);
    expect(mid(pos, 'u:u0')).toBe((card(pos, 'p:ann') + card(pos, 'p:ben')) / 2);
  });

  it('nudges a parents-unknown dot off a couple dot in its layer', () => {
    // Paul + Mary's dot and Sue + Sam's parents-unknown dot share a layer (y 100).
    const g: TreeGraph = {
      ...haleGraph(),
      persons: [
        gp('paul', 'Paul', 1920),
        gp('mary', 'Mary', 1922),
        gp('sue', 'Sue', 1950, { hasParents: true }),
        gp('sam', 'Sam', 1952, { hasParents: true }),
      ],
      unions: [
        gu('u-pm', 'paul', 'mary'),
        gu('u-0', null, null, { parentsUnknown: true, childCount: 2 }),
      ],
      links: [gl('l1', 'u-0', 'sue'), gl('l2', 'u-0', 'sam')],
    };
    const { f, laidOut, pos } = setup(g, [
      ['p:paul', 0, 0],
      ['p:mary', 216, 0],
      ['p:sue', 0, 200],
      ['p:sam', 216, 200],
      ['u:u-pm', 500, 100],
      ['u:u-0', 600, 100],
    ]);
    placeUnionDots(f.nodes, laidOut, pos, GAP);
    const want = (card(pos, 'p:paul') + card(pos, 'p:mary')) / 2;
    expect(mid(pos, 'u:u-pm')).toBe(want);
    expect(mid(pos, 'u:u-0')).toBe(want + STEP);
  });

  it("nudges a one-partner dot off a hub's couple dot, still under its partner", () => {
    // Seats [p3, p1, hub, p2]: the hub–p3 dot falls on p1's centre, where p1's own dot wants to go.
    const g: TreeGraph = {
      ...haleGraph(),
      persons: ['hub', 'p1', 'p2', 'p3']
        .map((id, i) => gp(id, id, 1950 + i))
        .concat(gp('kid', 'Kid', 1980, { hasParents: true })),
      unions: [
        gu('c3', 'hub', 'p3'),
        gu('c1', 'hub', 'p1'),
        gu('c2', 'hub', 'p2'),
        gu('s1', 'p1', null, { childCount: 1 }),
      ],
      links: [gl('l1', 's1', 'kid')],
    };
    const { f, laidOut, pos } = setup(g, [
      ['p:p3', 0, 0],
      ['p:p1', 216, 0],
      ['p:hub', 432, 0],
      ['p:p2', 648, 0],
      ['p:kid', 216, 200],
      ['u:c1', 0, 100],
      ['u:c2', 0, 100],
      ['u:c3', 0, 100],
      ['u:s1', 0, 100],
    ]);
    placeUnionDots(f.nodes, laidOut, pos, GAP);
    expect(mid(pos, 'u:c3')).toBe((card(pos, 'p:p3') + card(pos, 'p:hub')) / 2);
    expect(Math.abs(mid(pos, 'u:s1') - mid(pos, 'u:c3'))).toBeGreaterThanOrEqual(STEP);
    expect(Math.abs(mid(pos, 'u:s1') - card(pos, 'p:p1'))).toBeLessThan(CARD_WIDTH / 2);
  });
});
