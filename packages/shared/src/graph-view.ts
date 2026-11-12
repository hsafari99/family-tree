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

/** Who is whose parent, child and partner, for the line views below. */
function lineIndex(graph: LiveGraph) {
  const unionById = new Map(graph.unions.map((u) => [u.id, u]));
  const parents = new Map<string, Set<string>>();
  const childUnions = new Map<string, Set<string>>(); // child -> the unions they are a child of
  const kidsOf = new Map<string, string[]>(); // union -> children
  const unionsOf = new Map<string, string[]>(); // partner -> unions
  const partners = new Map<string, Set<string>>();
  const put = <V>(m: Map<string, Set<V>>, k: string, v: V) => {
    const s = m.get(k);
    if (s) s.add(v);
    else m.set(k, new Set([v]));
  };
  for (const u of graph.unions) {
    for (const p of partnersOf(u)) {
      unionsOf.set(p, [...(unionsOf.get(p) ?? []), u.id]);
      for (const q of partnersOf(u)) if (q !== p) put(partners, p, q);
    }
  }
  for (const l of graph.parentChild) {
    const u = unionById.get(l.unionId);
    if (!u) continue;
    kidsOf.set(l.unionId, [...(kidsOf.get(l.unionId) ?? []), l.childId]);
    put(childUnions, l.childId, l.unionId);
    for (const p of partnersOf(u)) put(parents, l.childId, p);
  }
  const sortedOf = (s: Iterable<string> | undefined) => [...(s ?? [])].sort();
  return {
    parentsOf: (id: string) => sortedOf(parents.get(id)),
    partnersOf: (id: string) => sortedOf(partners.get(id)),
    childrenOf: (id: string) =>
      sortedOf((unionsOf.get(id) ?? []).flatMap((u) => kidsOf.get(u) ?? [])),
    /** Full and half siblings: through any union they're a child of, and each parent's unions. */
    siblingsOf: (id: string) => {
      const out = new Set<string>();
      for (const u of childUnions.get(id) ?? []) for (const k of kidsOf.get(u) ?? []) out.add(k);
      for (const p of parents.get(id) ?? [])
        for (const u of unionsOf.get(p) ?? []) for (const k of kidsOf.get(u) ?? []) out.add(k);
      out.delete(id);
      return sortedOf(out);
    },
  };
}
type LineIndex = ReturnType<typeof lineIndex>;

/** Generation levels upward: [start], parents, grandparents… (parents-unknown unions add no one). */
function ancestorLevels(ix: LineIndex, startId: string, generations: number): string[][] {
  const seen = new Set([startId]);
  const levels = [[startId]];
  for (let d = 0; d < generations; d++) {
    const next = levels[d]!.flatMap(ix.parentsOf).filter((p) => !seen.has(p) && seen.add(p));
    if (next.length === 0) break;
    levels.push(next);
  }
  return levels;
}

/** Generation levels downward: [start + partners], children + their partners… */
function descendantLevels(ix: LineIndex, startId: string, generations: number): string[][] {
  const seen = new Set([startId]);
  const fresh = (ids: string[]) => ids.filter((id) => !seen.has(id) && seen.add(id));
  let blood = [startId];
  const levels = [[startId, ...fresh(ix.partnersOf(startId))]];
  for (let d = 0; d < generations; d++) {
    // Only a descendant's own unions: nobody else from a partner's side.
    blood = fresh(blood.flatMap(ix.childrenOf));
    if (blood.length === 0) break;
    levels.push([...blood, ...fresh(blood.flatMap(ix.partnersOf))]);
  }
  return levels;
}

/** Nearest level first, at most `limit` people. */
function takeLevels(levels: readonly string[][], limit: number): Neighbourhood {
  const ids = new Set<string>();
  for (const level of levels) {
    for (const id of level) {
      if (ids.has(id)) continue;
      if (ids.size >= limit) return { ids, truncated: true };
      ids.add(id);
    }
  }
  return { ids, truncated: false };
}

/** The start and their ancestors, up to `generations` levels (the fan chart). */
export function ancestorIds(
  graph: LiveGraph,
  startId: string,
  generations: number,
  limit: number,
): Neighbourhood {
  return takeLevels(ancestorLevels(lineIndex(graph), startId, generations), limit);
}

/** The start, their partners, and `generations` levels of descendants with theirs (the tree view). */
export function descendantIds(
  graph: LiveGraph,
  startId: string,
  generations: number,
  limit: number,
): Neighbourhood {
  return takeLevels(descendantLevels(lineIndex(graph), startId, generations), limit);
}

/**
 * The focus view, an hourglass: the person, their partners and siblings (half-siblings too), then
 * `generations` levels of their own ancestors above and of descendants (with partners) below. No
 * aunts, cousins, nephews or in-laws' families. Nearest generation first, at most `limit` people.
 */
export function hourglassIds(
  graph: LiveGraph,
  startId: string,
  generations: number,
  limit: number,
): Neighbourhood {
  const ix = lineIndex(graph);
  const up = ancestorLevels(ix, startId, generations);
  const down = descendantLevels(ix, startId, generations);
  const levels = [[...down[0]!, ...ix.siblingsOf(startId)]];
  for (let d = 1; d <= generations; d++) levels.push([...(up[d] ?? []), ...(down[d] ?? [])]);
  return takeLevels(levels, limit);
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
    const partners = partnersOf(u);
    const shown = partners.filter((p) => ids.has(p)).length;
    // A parents-unknown union (no partners) is drawn whenever one of its children is (brief #11).
    if (
      shown === 2 ||
      (shown === 1 && childShown.has(u.id)) ||
      (partners.length === 0 && childShown.has(u.id))
    ) {
      unionIds.add(u.id);
    }
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
