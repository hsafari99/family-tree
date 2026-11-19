import type { LinkedGraph, TreeGraph } from '@family-tree/shared';

/** A linked tree's marker on its bridge card (tree linking spec, Web: canvas). */
export interface BridgeMarker {
  linkId: string;
  treeName: string;
  /** People in the linked tree, not counting the bridge. */
  count: number;
  open: boolean;
}

/**
 * The tree's own graph with each unfolded linked tree hung off its bridge card (V1). A linked
 * tree whose bridge card isn't in this view is left out, so nothing floats unconnected. Linked
 * people carry `linkedTree`; their relations are read-only (the server says so too).
 */
export function mergeLinked(graph: TreeGraph, parts: readonly LinkedGraph[]): TreeGraph {
  const shown = new Set(graph.persons.map((p) => p.id));
  const add = parts.filter((p) => shown.has(p.bridgePersonId) && !p.graph.needsBranch);
  if (add.length === 0) return graph;
  const seen = new Set(shown);
  const persons = [...graph.persons];
  const unions = [...graph.unions];
  const links = [...graph.links];
  for (const part of add) {
    const linkedTree = { linkId: part.linkId, name: part.tree.name };
    for (const p of part.graph.persons) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      persons.push({ ...p, linkedTree, canAddRelative: false });
    }
    unions.push(...part.graph.unions.map((u) => ({ ...u, canEdit: false })));
    links.push(...part.graph.links);
  }
  return { ...graph, persons, unions, links };
}
