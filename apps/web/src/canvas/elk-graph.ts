import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { type Couple, seatCouples } from './couples';
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
 * Copies ELK's positions onto the React Flow nodes, seats partners side by side (brief #14) and
 * places the union dots, then sorts them by (y, x). React Flow renders nodes in array order, so
 * this makes Tab follow reading order (decision 15). The ELK input keeps the model order: call this
 * only on the way out.
 */
export function applyElkLayout(
  nodes: CanvasNode[],
  laidOut: ElkNode,
  couples: readonly Couple[] = [],
  blood: readonly string[] = [],
): CanvasNode[] {
  const pos = new Map((laidOut.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  const gap = Number(ELK_LAYOUT_OPTIONS['elk.spacing.nodeNode']);
  // Row by row from the top: seat the row (each family under its parents' dot, now that the row
  // above is final), then put down the dots that hang from it.
  const dots = dotPlacer(nodes, laidOut, pos, gap);
  const bloodSet = new Set(blood);
  for (const y of personRows(pos)) {
    seatCouples(pos, couples, bloodSet, gap, { row: y, anchor: dots.anchor });
    dots.unknownOver(y);
    dots.under(y);
  }
  dots.rest();
  return nodes
    .map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, position: p } : n;
    })
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
}

type Pos = { x: number; y: number };
const personRows = (pos: ReadonlyMap<string, Pos>) =>
  [...new Set([...pos].filter(([id]) => id.startsWith('p:')).map(([, p]) => Math.round(p.y)))].sort(
    (a, b) => a - b,
  );

/**
 * Places every union dot once seatCouples has moved the people (brief #11, #14). A couple's dot goes
 * midway between them; a one-partner dot under its partner's card (several fan out side by side); a
 * parents-unknown dot over its shown children. In that order, each dot is nudged sideways, in
 * steps, off any dot already placed in its layer. Mutates `pos`.
 */
export function placeUnionDots(
  nodes: readonly CanvasNode[],
  laidOut: ElkNode,
  pos: Map<string, Pos>,
  gap: number,
): void {
  const dots = dotPlacer(nodes, laidOut, pos, gap);
  for (const y of personRows(pos)) dots.under(y);
  for (const y of personRows(pos)) dots.unknownOver(y);
  dots.rest();
}

/** The dot pass, a row at a time (see placeUnionDots), and where each child's parents' dot is. */
function dotPlacer(
  nodes: readonly CanvasNode[],
  laidOut: ElkNode,
  pos: Map<string, Pos>,
  gap: number,
) {
  const centre = (id: string) => pos.get(id)!.x + CARD_WIDTH / 2;
  const rowOf = (id: string) => Math.round(pos.get(id)!.y);
  const step = UNION_SIZE + gap / 2;
  const placed: Pos[] = [];
  const done = new Set<string>();
  const clashes = (x: number, y: number) =>
    placed.some((q) => Math.abs(q.y - y) < UNION_SIZE && Math.abs(q.x - x) < step);
  const put = (id: string, want: number) => {
    const y = pos.get(id)!.y;
    const x0 = want - UNION_SIZE / 2;
    let x = x0;
    // +1, −1, +2, −2 … steps from where it wants to be, until it is clear.
    for (let k = 1; clashes(x, y); k++) x = x0 + Math.ceil(k / 2) * step * (k % 2 === 1 ? 1 : -1);
    const p = { x, y };
    pos.set(id, p);
    placed.push(p);
    done.add(id);
  };
  const shown = (id: string | null) => (id !== null && pos.has(`p:${id}`) ? `p:${id}` : null);
  const kidsOf = new Map<string, string[]>(); // union node id -> its shown children's node ids
  const parentsOf = new Map<string, string>(); // child node id -> their (first) parents' dot
  for (const e of laidOut.edges ?? []) {
    const [from, to] = [e.sources[0]!, e.targets[0]!];
    if (!e.id.startsWith('child:') || !pos.has(to)) continue;
    kidsOf.set(from, [...(kidsOf.get(from) ?? []), to]);
    if (!parentsOf.has(to)) parentsOf.set(to, from);
  }
  const couples: [string, string, string][] = [];
  const singles = new Map<string, string[]>(); // partner node id -> their one-partner dots
  const unknown: string[] = [];
  for (const n of nodes) {
    if (n.type !== 'union' || !pos.has(n.id)) continue;
    const ps = [shown(n.data.union.partnerAId), shown(n.data.union.partnerBId)].filter(
      (p) => p !== null,
    );
    if (ps.length === 2) couples.push([n.id, ps[0]!, ps[1]!]);
    else if (ps.length === 1) singles.set(ps[0]!, [...(singles.get(ps[0]!) ?? []), n.id]);
    else unknown.push(n.id);
  }
  return {
    /** Where a person's parents' dot is (its centre x), once it has been placed. */
    anchor: (personId: string) => {
      const dot = parentsOf.get(personId);
      return dot !== undefined && done.has(dot) ? pos.get(dot)!.x + UNION_SIZE / 2 : undefined;
    },
    /** The couple and one-partner dots of the people in row y. */
    under(y: number) {
      for (const [id, a, b] of couples)
        if (!done.has(id) && rowOf(a) === y) put(id, (centre(a) + centre(b)) / 2);
      // A card's centre is at least (CARD_WIDTH + gap) / 2 from any couple dot of its row, so up to
      // five dots fan out under one card before the nudge has anything to do.
      for (const [p, list] of singles) {
        if (rowOf(p) !== y) continue;
        list.forEach((id, i) => put(id, centre(p) + (i - (list.length - 1) / 2) * step));
      }
    },
    /** The parents-unknown dots over children in row y. */
    unknownOver(y: number) {
      for (const id of unknown) {
        const kids = kidsOf.get(id) ?? [];
        if (done.has(id) || kids.length === 0 || rowOf(kids[0]!) !== y) continue;
        put(id, kids.reduce((sum, k) => sum + centre(k), 0) / kids.length);
      }
    },
    /** Any dot left (a parents-unknown dot with no shown child) stays where ELK put it. */
    rest() {
      for (const id of unknown) if (!done.has(id)) put(id, pos.get(id)!.x + UNION_SIZE / 2);
    },
  };
}
