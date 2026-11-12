import { describe, expect, it } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, graphToFlow, UNION_SIZE } from './graph-to-flow';
import { gp, gu, haleGraph, unknownParentsGraph } from './test-fixtures';

const ctx = { focusId: 'leo', meId: 'emma' };

describe('graphToFlow', () => {
  it('makes one card per person and one dot per drawn union, with fixed sizes', () => {
    const { nodes } = graphToFlow(haleGraph(), ctx);
    expect(nodes.filter((n) => n.type === 'person')).toHaveLength(10);
    expect(
      nodes
        .filter((n) => n.type === 'union')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['u:u-da', 'u:u-dl', 'u:u-rm', 'u:u-s']);
    const card = nodes.find((n) => n.id === 'p:robert')!;
    expect([card.width, card.height]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
    expect(nodes.find((n) => n.id === 'u:u-rm')!.width).toBe(UNION_SIZE);
  });

  it('links partners into the union and the union down to each child, styled by kind and status', () => {
    const { edges } = graphToFlow(haleGraph(), ctx);
    const e = (id: string) => edges.find((x) => x.id === id)!;
    expect(e('partner:u-rm:robert')).toMatchObject({
      source: 'p:robert',
      target: 'u:u-rm',
      className: 'edge-partner',
    });
    expect(e('child:l-mia')).toMatchObject({
      source: 'u:u-dl',
      target: 'p:mia',
      className: 'edge-child edge-adoptive',
    });
    expect(e('child:l-leo').className).toBe('edge-child edge-biological');
    expect(e('partner:u-da:anna').className).toBe('edge-partner edge-ended');
    expect(edges.filter((x) => x.source === 'p:susan')).toHaveLength(1); // single-parent union
  });

  it('labels union dots and marks ended ones', () => {
    const { nodes } = graphToFlow(haleGraph(), ctx);
    const rm = nodes.find((n) => n.id === 'u:u-rm')!;
    expect(rm.data).toMatchObject({
      ended: false,
      label: 'Relationship of Robert Hale and Margaret Hale (Widowed)',
    });
    expect(nodes.find((n) => n.id === 'u:u-da')!.data).toMatchObject({ ended: true });
  });

  it('skips a union whose only shown partner has no shown children, and names a hidden partner', () => {
    const lone = { ...haleGraph(), persons: [gp('robert', 'Robert', 1930)], links: [] };
    expect(graphToFlow(lone, ctx).nodes.some((n) => n.type === 'union')).toBe(false);
    const half = {
      ...haleGraph(),
      persons: [gp('robert', 'Robert', 1930), gp('david', 'David', 1956)],
      unions: [gu('u-rm', 'robert', 'margaret')],
      links: [{ id: 'l-david', unionId: 'u-rm', childId: 'david', kind: 'biological' as const }],
    };
    const flow = graphToFlow(half, ctx);
    expect(flow.nodes.find((n) => n.id === 'u:u-rm')!.data).toMatchObject({
      label: 'Relationship of Robert Hale and someone not shown (Married)',
    });
    expect(flow.edges.filter((x) => x.target === 'u:u-rm')).toHaveLength(1);
  });

  it('lists families with children in sibling order', () => {
    expect(graphToFlow(haleGraph(), ctx).families.find((f) => f.id === 'u-dl')).toEqual({
      id: 'u-dl',
      partnerIds: ['david', 'laura'],
      childIds: ['leo', 'mia'],
    });
    expect(
      graphToFlow(haleGraph({ leoOrder: 2, miaOrder: 1 }), ctx).families.find(
        (f) => f.id === 'u-dl',
      )!.childIds,
    ).toEqual(['mia', 'leo']);
  });

  it('flags the focus person and the user', () => {
    const { nodes } = graphToFlow(haleGraph(), ctx);
    expect(nodes.find((n) => n.id === 'p:leo')!.data).toMatchObject({ isFocus: true, isMe: false });
    expect(nodes.find((n) => n.id === 'p:emma')!.data).toMatchObject({
      isFocus: false,
      isMe: true,
    });
  });

  it('makes children draggable only when their union is editable and fully shown', () => {
    const drag = (g: ReturnType<typeof haleGraph>) =>
      Object.fromEntries(
        graphToFlow(g, ctx)
          .nodes.filter((n) => n.type === 'person')
          .map((n) => [n.id.slice(2), n.type === 'person' && n.data.reorderUnionId !== null]),
      );
    const d = drag(haleGraph());
    for (const id of ['leo', 'mia', 'david', 'susan']) expect(d[id]).toBe(true);
    for (const id of ['emma', 'noah', 'robert', 'margaret', 'anna', 'laura'])
      expect(d[id]).toBe(false);
    const g = haleGraph();
    const noEdit = {
      ...g,
      unions: g.unions.map((u) => (u.id === 'u-dl' ? { ...u, canEdit: false } : u)),
    };
    expect([drag(noEdit).leo, drag(noEdit).mia]).toEqual([false, false]);
    const more = {
      ...g,
      unions: g.unions.map((u) => (u.id === 'u-dl' ? { ...u, childCount: 3 } : u)),
    };
    expect([drag(more).leo, drag(more).mia]).toEqual([false, false]);
    const leo = graphToFlow(g, ctx).nodes.find((n) => n.id === 'p:leo');
    expect(leo!.type === 'person' && leo!.data.reorderUnionId).toBe('u-dl');
  });

  it('lets partners in an editable couple be dragged, when sibling drag does not apply (brief #16)', () => {
    const g = haleGraph();
    const d = graphToFlow(g, ctx).nodes.filter((n) => n.type === 'person');
    const by = (id: string) => d.find((n) => n.id === `p:${id}`)!;
    for (const id of ['robert', 'margaret', 'anna', 'laura']) {
      const n = by(id);
      expect(n.type === 'person' && n.data.coupleDrag, id).toBe(true);
      expect(n.draggable, id).toBe(true);
    }
    // David is sibling-draggable (Robert and Margaret's child): that gesture wins.
    const david = by('david');
    expect(david.type === 'person' && david.data.coupleDrag).toBe(false);
    for (const id of ['emma', 'noah']) expect(by(id).draggable, id).toBe(false);
    const r = graphToFlow(
      { ...g, unions: g.unions.map((u) => (u.id === 'u-rm' ? { ...u, canEdit: false } : u)) },
      ctx,
    ).nodes.find((n) => n.id === 'p:robert')!;
    expect(r.draggable).toBe(false);
    expect(graphToFlow(g, ctx).couples).toContainEqual({
      unionId: 'u-dl',
      a: 'p:david',
      b: 'p:laura',
      aOrder: null,
      bOrder: null,
    });
  });

  it('gives edges meaningful labels, not the defaults', () => {
    const { edges } = graphToFlow(haleGraph(), ctx);
    const e = (id: string) => edges.find((x) => x.id === id)!;
    expect(e('partner:u-rm:robert').ariaLabel).toBe(
      'Robert Hale, partner in the relationship of Robert Hale and Margaret Hale',
    );
    expect(e('child:l-leo').ariaLabel).toBe('Leo Hale, child of David Hale and Laura Chen');
    expect(edges.every((x) => !/p:|u:/.test(x.ariaLabel ?? ''))).toBe(true);
  });
});

describe('graphToFlow with unknown parents (brief #11)', () => {
  it('draws a dot for siblings with unknown parents, with a child edge each', () => {
    const { nodes, edges, families } = graphToFlow(unknownParentsGraph(), ctx);
    const dot = nodes.find((n) => n.id === 'u:u0')!;
    expect(dot.type === 'union' && dot.data.label).toBe('Siblings with unknown parents');
    expect(edges.filter((e) => e.source === 'u:u0').map((e) => e.id)).toEqual([
      'child:l-ann',
      'child:l-ben',
    ]);
    expect(edges.find((e) => e.id === 'child:l-ann')!.ariaLabel).toBe(
      'Ann Hale, child of unknown parents',
    );
    expect(families.find((f) => f.id === 'u0')).toEqual({
      id: 'u0',
      partnerIds: [],
      childIds: ['ann', 'ben'],
    });
  });

  it('skips a parents-unknown union with no child shown', () => {
    const g = unknownParentsGraph();
    const { nodes } = graphToFlow({ ...g, links: g.links.filter((l) => l.unionId !== 'u0') }, ctx);
    expect(nodes.some((n) => n.id === 'u:u0')).toBe(false);
  });
});

describe('graphToFlow reconnectable child edges (brief #13)', () => {
  it('lets the dot end of an editable union’s child edge be dragged, and nothing else', () => {
    const g = haleGraph();
    g.unions = g.unions.map((u) => (u.id === 'u-s' ? { ...u, canEdit: false } : u));
    const { edges } = graphToFlow(g, ctx);
    expect(edges.find((e) => e.id === 'child:l-leo')!.reconnectable).toBe('source');
    expect(edges.find((e) => e.id === 'child:l-noah')!.reconnectable).toBe(false);
    expect(edges.filter((e) => e.id.startsWith('partner:')).every((e) => !e.reconnectable)).toBe(
      true,
    );
  });
});
