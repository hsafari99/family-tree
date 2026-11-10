import { describe, expect, it } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, graphToFlow, UNION_SIZE } from './graph-to-flow';
import { gp, gu, haleGraph } from './test-fixtures';

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
});
