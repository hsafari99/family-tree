import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { CARD_WIDTH, type CanvasNode, type Flow, UNION_SIZE } from './graph-to-flow';

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
    // Shifted up by 2 so a parents-unknown dot above row 0 is still non-negative.
    if (n.type === 'person') return 2 * (generations.get(n.data.person.id) ?? 0) + 2;
    const rows = [n.data.union.partnerAId, n.data.union.partnerBId]
      .map((id) => (id === null ? undefined : generations.get(id)))
      .filter((g): g is number => g !== undefined);
    if (rows.length > 0) return 2 * Math.min(...rows) + 3;
    // Parents unknown (brief #11): the slot just above the children.
    const fam = flow.families.find((f) => f.id === n.data.union.id);
    const kids = (fam?.childIds ?? [])
      .map((c) => generations.get(c))
      .filter((g): g is number => g !== undefined);
    return kids.length > 0 ? 2 * Math.min(...kids) + 1 : undefined;
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
  // ELK puts a union dot anywhere in its row; centre it between two shown partners so the
  // couple reads as a pair (it keeps ELK's y, the row between partners and children).
  for (const n of nodes) {
    if (n.type !== 'union') continue;
    const dot = pos.get(n.id);
    const partners = [n.data.union.partnerAId, n.data.union.partnerBId]
      .map((id) => (id ? pos.get(`p:${id}`) : undefined))
      .filter((p) => p !== undefined);
    if (!dot || partners.length !== 2) continue;
    const mid = (partners[0]!.x + partners[1]!.x + CARD_WIDTH) / 2;
    pos.set(n.id, { x: mid - UNION_SIZE / 2, y: dot.y });
  }
  return nodes
    .map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, position: p } : n;
    })
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
}
