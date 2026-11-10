import { type LiveGraph, partnersOf } from './family-graph.js';

/** Close relatives (decision 2): person id -> parents, children, partners and siblings. */
export type KinIndex = ReadonlyMap<string, ReadonlySet<string>>;

export function kinIndex(graph: LiveGraph): KinIndex {
  const kin = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      let s = kin.get(x);
      if (!s) kin.set(x, (s = new Set()));
      s.add(y);
    }
  };
  const unionById = new Map(graph.unions.map((u) => [u.id, u]));
  const kids = new Map<string, string[]>();
  for (const u of graph.unions) {
    if (u.partnerAId !== null && u.partnerBId !== null) link(u.partnerAId, u.partnerBId);
  }
  for (const l of graph.parentChild) {
    const u = unionById.get(l.unionId);
    if (!u) continue;
    for (const p of partnersOf(u)) link(p, l.childId);
    const list = kids.get(l.unionId);
    if (list) list.push(l.childId);
    else kids.set(l.unionId, [l.childId]);
  }
  for (const list of kids.values()) for (const a of list) for (const b of list) link(a, b);
  return kin;
}

export interface Neighbourhood {
  ids: Set<string>;
  truncated: boolean;
}

/**
 * Everyone within `depth` close-relative steps of `startId`, breadth first and nearest first,
 * at most `limit` people. `within` restricts the walk (the branch view).
 */
export function neighbourhood(
  kin: KinIndex,
  startId: string,
  depth: number,
  limit: number,
  within?: ReadonlySet<string>,
): Neighbourhood {
  const ids = new Set([startId]);
  let frontier = [startId];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      // Sorted so a truncated view is the same on every request.
      for (const n of [...(kin.get(id) ?? [])].sort()) {
        if (ids.has(n) || (within && !within.has(n))) continue;
        if (ids.size >= limit) return { ids, truncated: true };
        ids.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return { ids, truncated: false };
}

/** Everyone reachable from the root through any relation (spec §3 "Disconnected people"). */
export function connectedTo(kin: KinIndex, rootId: string | null): Set<string> {
  if (rootId === null) return new Set();
  return neighbourhood(kin, rootId, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY).ids;
}

/** The unions and links drawn among `ids` (decision 3). */
export function visibleRelations(graph: LiveGraph, ids: ReadonlySet<string>) {
  const childShown = new Set<string>();
  for (const l of graph.parentChild) if (ids.has(l.childId)) childShown.add(l.unionId);
  const unionIds = new Set<string>();
  for (const u of graph.unions) {
    const shown = partnersOf(u).filter((p) => ids.has(p)).length;
    if (shown === 2 || (shown === 1 && childShown.has(u.id))) unionIds.add(u.id);
  }
  const linkIds = new Set<string>();
  for (const l of graph.parentChild) {
    if (unionIds.has(l.unionId) && ids.has(l.childId)) linkIds.add(l.id);
  }
  return { unionIds, linkIds };
}

/** People in `ids` with a close relative outside `ids`. */
export function withHiddenRelatives(kin: KinIndex, ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    for (const n of kin.get(id) ?? []) {
      if (!ids.has(n)) {
        out.add(id);
        break;
      }
    }
  }
  return out;
}
