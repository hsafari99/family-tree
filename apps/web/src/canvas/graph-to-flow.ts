import {
  compareSiblings,
  type GraphPerson,
  type GraphUnionView,
  type TreeGraph,
} from '@family-tree/shared';
import type { Edge, Node } from '@xyflow/react';
import { personName, UNION_STATUS_LABEL } from '../trees/format';

export const CARD_WIDTH = 184;
export const CARD_HEIGHT = 88;
/** The union node's box, which is also its hit area: 24px meets WCAG 2.5.8. The visible dot inside is 12px. */
export const UNION_SIZE = 24;

export type PersonNodeData = {
  person: GraphPerson;
  isFocus: boolean;
  isMe: boolean;
  /** The union whose children this card can be dragged among (Task 17); null when fixed. */
  reorderUnionId: string | null;
};
export type PersonFlowNode = Node<PersonNodeData, 'person'>;
export type UnionNodeData = { union: GraphUnionView; ended: boolean; label: string };
export type UnionFlowNode = Node<UnionNodeData, 'union'>;
export type CanvasNode = PersonFlowNode | UnionFlowNode;
/** A drawn union: its shown partners, and its shown children in sibling order. */
export interface Family {
  id: string;
  partnerIds: string[];
  childIds: string[];
}
export interface Flow {
  nodes: CanvasNode[];
  edges: Edge[];
  families: Family[];
  personIds: string[];
}

export const personNodeId = (id: string) => `p:${id}`;
export const unionNodeId = (id: string) => `u:${id}`;
const ENDED = new Set<string>(['divorced', 'separated']);

/** People and unions -> React Flow nodes and edges, with unions as their own small nodes (spec §6). */
export function graphToFlow(
  graph: TreeGraph,
  { focusId, meId }: { focusId: string | null; meId: string | null },
): Flow {
  const byId = new Map(graph.persons.map((p) => [p.id, p]));
  const persons = [...graph.persons].sort(compareSiblings);
  const nodes: CanvasNode[] = persons.map((person) => ({
    id: personNodeId(person.id),
    type: 'person',
    position: { x: 0, y: 0 },
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    draggable: false,
    data: {
      person,
      isFocus: person.id === focusId,
      isMe: person.id === meId,
      reorderUnionId: null,
    },
  }));
  const edges: Edge[] = [];
  const families: Family[] = [];
  for (const u of graph.unions) {
    const partnerIds = [u.partnerAId, u.partnerBId].filter(
      (id): id is string => id !== null && byId.has(id),
    );
    const children = graph.links
      .filter((l) => l.unionId === u.id && byId.has(l.childId))
      .sort((a, b) => compareSiblings(byId.get(a.childId)!, byId.get(b.childId)!));
    if (partnerIds.length === 0 || (partnerIds.length < 2 && children.length === 0)) continue;
    const ended = ENDED.has(u.status);
    const names = partnerIds.map((id) => personName(byId.get(id)!));
    if (names.length === 1 && u.partnerAId !== null && u.partnerBId !== null) {
      names.push('someone not shown');
    }
    nodes.push({
      id: unionNodeId(u.id),
      type: 'union',
      position: { x: 0, y: 0 },
      width: UNION_SIZE,
      height: UNION_SIZE,
      draggable: false,
      data: {
        union: u,
        ended,
        label: `Relationship of ${names.join(' and ')} (${UNION_STATUS_LABEL[u.status]})`,
      },
    });
    for (const p of partnerIds) {
      edges.push({
        id: `partner:${u.id}:${p}`,
        source: personNodeId(p),
        target: unionNodeId(u.id),
        type: 'smoothstep',
        className: ended ? 'edge-partner edge-ended' : 'edge-partner',
        selectable: false,
        focusable: false,
        ariaLabel: `${personName(byId.get(p)!)}, partner in the relationship of ${names.join(' and ')}`,
      });
    }
    for (const l of children) {
      edges.push({
        id: `child:${l.id}`,
        source: unionNodeId(u.id),
        target: personNodeId(l.childId),
        type: 'smoothstep',
        className: `edge-child edge-${l.kind}`,
        selectable: false,
        focusable: false,
        ariaLabel: `${personName(byId.get(l.childId)!)}, child of ${names.join(' and ')}`,
      });
    }
    families.push({ id: u.id, partnerIds, childIds: children.map((l) => l.childId) });
  }
  const reorderable = new Map<string, string>(); // child id -> the union they can be dragged in
  for (const u of graph.unions) {
    const fam = families.find((f) => f.id === u.id);
    if (!fam || !u.canEdit || u.childCount < 2 || fam.childIds.length !== u.childCount) continue;
    for (const c of fam.childIds) if (!reorderable.has(c)) reorderable.set(c, u.id);
  }
  for (const n of nodes) {
    if (n.type !== 'person') continue;
    const unionId = reorderable.get(n.data.person.id) ?? null;
    n.data.reorderUnionId = unionId;
    n.draggable = unionId !== null;
    if (unionId) n.className = 'is-reorderable';
  }
  return { nodes, edges, families, personIds: persons.map((p) => p.id) };
}
