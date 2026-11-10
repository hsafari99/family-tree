import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { CanvasNode, Flow } from './graph-to-flow';

/** ELK layered, top to bottom, generations as partitions (decision 13). */
export const ELK_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  // Model order (sibling_order) breaks ties; crossings still come first.
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.considerModelOrder.crossingCounterNodeInfluence': '0.001',
  'elk.spacing.nodeNode': '32',
  'elk.layered.spacing.nodeNodeBetweenLayers': '28',
  'elk.spacing.componentComponent': '72',
  'elk.separateConnectedComponents': 'true',
};

export function toElkGraph(flow: Flow, generations: ReadonlyMap<string, number> | null): ElkNode {
  const partition = (n: CanvasNode): number | undefined => {
    if (!generations) return undefined;
    if (n.type === 'person') return 2 * (generations.get(n.data.person.id) ?? 0);
    const rows = [n.data.union.partnerAId, n.data.union.partnerBId]
      .map((id) => (id === null ? undefined : generations.get(id)))
      .filter((g): g is number => g !== undefined);
    return 2 * Math.min(...rows) + 1;
  };
  return {
    id: 'root',
    layoutOptions: {
      ...ELK_LAYOUT_OPTIONS,
      ...(generations ? { 'elk.partitioning.activate': 'true' } : {}),
    },
    children: flow.nodes.map((n) => {
      const p = partition(n);
      return {
        id: n.id,
        width: n.width,
        height: n.height,
        ...(p === undefined ? {} : { layoutOptions: { 'elk.partitioning.partition': String(p) } }),
      };
    }),
    edges: flow.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

/**
 * Copies ELK's positions onto the React Flow nodes, then sorts them by (y, x). React Flow renders
 * nodes in array order, so this makes Tab follow reading order (decision 15). The ELK input
 * keeps the model order: call this only on the way out.
 */
export function applyElkLayout(nodes: CanvasNode[], laidOut: ElkNode): CanvasNode[] {
  const pos = new Map((laidOut.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  return nodes
    .map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, position: p } : n;
    })
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
}
