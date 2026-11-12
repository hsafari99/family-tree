import {
  compareSiblings,
  type GraphPerson,
  type GraphUnionView,
  sortYear,
  type TreeGraph,
} from '@family-tree/shared';
import type { Edge, Node } from '@xyflow/react';
import { personName, UNION_STATUS_LABEL } from '../trees/format';
import type { Couple } from './couples';

export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 72;
/** The union node's box, which is also its hit area: 24px meets WCAG 2.5.8. The visible dot inside is 12px. */
export const UNION_SIZE = 24;

export type PersonNodeData = {
  person: GraphPerson;
  isFocus: boolean;
  isMe: boolean;
  /** The union whose children this card can be dragged among (Task 17); null when fixed. */
  reorderUnionId: string | null;
  /** In an editable couple on screen: dragging past a partner swaps or reorders (brief #16). */
  coupleDrag: boolean;
  /** Collapse state (Task 13): open when they have children shown, collapsed with a count. */
  branch: { collapsed: false } | { collapsed: true; hidden: number } | null;
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
  /** Each shown child's link, for the `child:<link>` edge ids (lineage, Task 7). */
  childLinks: { childId: string; linkId: string }[];
}
export interface Flow {
  nodes: CanvasNode[];
  edges: Edge[];
  families: Family[];
  personIds: string[];
  /** Shown two-partner unions, for seating partners side by side (brief #14). */
  couples: Couple[];
  /** Node ids of people shown as someone's child. */
  blood: string[];
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
      coupleDrag: false,
      branch: null,
    },
  }));
  const edges: Edge[] = [];
  const families: Family[] = [];
  const couples: Couple[] = [];
  const coupleIds = new Set<string>(); // people in an editable couple on screen
  const blood = new Set<string>();
  for (const [rank, u] of graph.unions.entries()) {
    const partnerIds = [u.partnerAId, u.partnerBId].filter(
      (id): id is string => id !== null && byId.has(id),
    );
    const children = graph.links
      .filter((l) => l.unionId === u.id && byId.has(l.childId))
      .sort((a, b) => compareSiblings(byId.get(a.childId)!, byId.get(b.childId)!));
    // Siblings whose parents are unknown (brief #11): a dot with no partners, drawn for its children.
    const unknownParents = u.partnerAId === null && u.partnerBId === null;
    if (
      unknownParents
        ? children.length === 0
        : partnerIds.length === 0 || (partnerIds.length < 2 && children.length === 0)
    )
      continue;
    const ended = ENDED.has(u.status);
    const names = unknownParents
      ? ['unknown parents']
      : partnerIds.map((id) => personName(byId.get(id)!));
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
        label: unknownParents
          ? 'Siblings with unknown parents'
          : `Relationship of ${names.join(' and ')} (${UNION_STATUS_LABEL[u.status]})`,
      },
    });
    for (const p of partnerIds) {
      edges.push({
        id: `partner:${u.id}:${p}`,
        source: personNodeId(p),
        target: unionNodeId(u.id),
        type: 'family',
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
        type: 'family',
        className: `edge-child edge-${l.kind}`,
        selectable: false,
        focusable: false,
        // Its dot end can be dragged onto another union dot to re-link the child (brief #13).
        reconnectable: u.canEdit ? 'source' : false,
        ariaLabel: `${personName(byId.get(l.childId)!)}, child of ${names.join(' and ')}`,
      });
    }
    families.push({
      id: u.id,
      partnerIds,
      childIds: children.map((l) => l.childId),
      childLinks: children.map((l) => ({ childId: l.childId, linkId: l.id })),
    });
    if (partnerIds.length === 2) {
      if (u.canEdit) for (const p of partnerIds) coupleIds.add(p);
      couples.push({
        unionId: u.id,
        a: personNodeId(u.partnerAId!),
        b: personNodeId(u.partnerBId!),
        aOrder: u.partnerAOrder,
        bOrder: u.partnerBOrder,
        since: u.startDate ? sortYear(u.startDate) : null,
        rank,
      });
    }
    for (const l of children) blood.add(personNodeId(l.childId));
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
    // Sibling drag wins: it is the established gesture (brief #16).
    n.data.coupleDrag = unionId === null && coupleIds.has(n.data.person.id);
    n.draggable = unionId !== null || n.data.coupleDrag;
    if (n.draggable) n.className = 'is-reorderable';
  }
  return {
    nodes,
    edges,
    families,
    personIds: persons.map((p) => p.id),
    couples,
    blood: [...blood],
  };
}
