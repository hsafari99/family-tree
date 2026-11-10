import type { KinStep } from '@family-tree/shared';
import type { Edge } from '@xyflow/react';
import type { CanvasNode } from './graph-to-flow';

export interface PathHighlight {
  personIds: ReadonlySet<string>;
  unionIds: ReadonlySet<string>;
  /** graphToFlow edge ids: `partner:<union>:<person>` and `child:<link>`. */
  edgeIds: ReadonlySet<string>;
}

export function pathHighlight(fromId: string, steps: readonly KinStep[]): PathHighlight {
  const personIds = new Set([fromId]);
  const unionIds = new Set<string>();
  const edgeIds = new Set<string>();
  let prev = fromId;
  for (const s of steps) {
    personIds.add(s.personId);
    unionIds.add(s.unionId);
    if (s.move === 'partner') {
      edgeIds.add(`partner:${s.unionId}:${prev}`);
      edgeIds.add(`partner:${s.unionId}:${s.personId}`);
    } else {
      // child → union dot → parent, whichever way the step goes.
      const parent = s.move === 'parent' ? s.personId : prev;
      edgeIds.add(`child:${s.linkId}`);
      edgeIds.add(`partner:${s.unionId}:${parent}`);
    }
    prev = s.personId;
  }
  return { personIds, unionIds, edgeIds };
}

const withClass = (cls: string | undefined, add: string) => (cls ? `${cls} ${add}` : add);

/** Marks the path on laid-out nodes and edges; no re-layout (decision 24). */
export function applyHighlight(nodes: CanvasNode[], edges: Edge[], h: PathHighlight) {
  return {
    nodes: nodes.map((n) => {
      const on =
        n.type === 'person' ? h.personIds.has(n.data.person.id) : h.unionIds.has(n.data.union.id);
      return on ? { ...n, className: withClass(n.className, 'is-path') } : n;
    }),
    edges: edges.map((e) =>
      h.edgeIds.has(e.id) ? { ...e, className: withClass(e.className, 'edge-path'), zIndex: 1 } : e,
    ),
  };
}
