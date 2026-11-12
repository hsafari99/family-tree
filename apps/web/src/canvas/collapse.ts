import type { TreeGraph } from '@family-tree/shared';

export interface Collapsed {
  graph: TreeGraph;
  /** Per shown or hidden collapsed person: how many people their collapse hides. */
  hiddenCount: Map<string, number>;
  /** Per hidden person: the collapsed people whose branch they are in. */
  hiddenBy: Map<string, string[]>;
}

/**
 * Hides collapsed people's branches (Task 13). A person is shown when they can be reached from the
 * anchor (the focus person, else the root) without going down through a collapsed person's
 * children: links from a collapsed person's unions to their children can be climbed (a child up to
 * the collapsed parents) but not descended. So a collapsed person's descendants go, with their
 * partners and anyone in the drawing only through them (in-laws), while a descendant also
 * reachable through a parent who isn't collapsed stays. The anchor (and the graph's focus) is never
 * hidden; collapsed ids not in the graph are ignored.
 */
export function collapseGraph(
  graph: TreeGraph,
  collapsed: ReadonlySet<string>,
  anchorId: string | null = graph.focusId,
): Collapsed {
  const present = new Set(graph.persons.map((p) => p.id));
  const shut = [...collapsed].filter((id) => present.has(id));
  if (shut.length === 0) return { graph, hiddenCount: new Map(), hiddenBy: new Map() };
  const shutSet = new Set(shut);

  // A graph of people and unions ('u:' ids). Partner edges go both ways; a child link is `up`
  // (child -> union) and `down` (union -> child).
  const partners = new Map<string, string[]>(); // union -> its shown partners
  const unionsOf = new Map<string, string[]>(); // person -> unions they are a partner in
  const kids = new Map<string, string[]>(); // union -> children
  const parentsOf = new Map<string, string[]>(); // child -> unions they are a child of
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  for (const u of graph.unions) {
    for (const p of [u.partnerAId, u.partnerBId]) {
      if (p === null || !present.has(p)) continue;
      push(partners, u.id, p);
      push(unionsOf, p, u.id);
    }
  }
  for (const l of graph.links) {
    if (!present.has(l.childId)) continue;
    push(kids, l.unionId, l.childId);
    push(parentsOf, l.childId, l.unionId);
  }
  const isCut = (unionId: string) => (partners.get(unionId) ?? []).some((p) => shutSet.has(p));

  /** People reached from `start`; `descend(union)` says whether a union's children can be reached. */
  const walk = (start: Iterable<string>, descend: (unionId: string) => boolean) => {
    const seen = new Set<string>();
    const unions = new Set<string>();
    const queue: string[] = [];
    const visit = (p: string) => {
      if (seen.has(p)) return;
      seen.add(p);
      queue.push(p);
    };
    for (const p of start) visit(p);
    for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
      for (const u of [...(unionsOf.get(p) ?? []), ...(parentsOf.get(p) ?? [])]) {
        if (unions.has(u)) continue;
        unions.add(u);
        for (const q of partners.get(u) ?? []) visit(q);
        if (descend(u)) for (const c of kids.get(u) ?? []) visit(c);
      }
    }
    return seen;
  };

  // Each collapsed person's branch, for the counts: from their children through partners, children
  // and parents, but never back up into a collapsed person's union.
  const branchOf = (c: string) => {
    const start = (unionsOf.get(c) ?? []).flatMap((u) => kids.get(u) ?? []);
    const seen = new Set<string>();
    const queue: string[] = [];
    const visit = (p: string) => {
      if (p === c || seen.has(p)) return;
      seen.add(p);
      queue.push(p);
    };
    start.forEach(visit);
    const done = new Set<string>();
    for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
      const up = (parentsOf.get(p) ?? []).filter((u) => !isCut(u));
      for (const u of [...(unionsOf.get(p) ?? []), ...up]) {
        if (done.has(u)) continue;
        done.add(u);
        for (const q of partners.get(u) ?? []) visit(q);
        for (const k of kids.get(u) ?? []) visit(k);
      }
    }
    return seen;
  };
  const branches = new Map(shut.map((c) => [c, branchOf(c)]));

  const anchors = [anchorId, graph.focusId].filter(
    (id): id is string => id !== null && present.has(id),
  );
  let start: string[] = anchors;
  if (start.length === 0) {
    // No anchor shown: start from everyone outside every branch.
    const inBranch = new Set([...branches.values()].flatMap((b) => [...b]));
    start = [...present].filter((id) => !inBranch.has(id));
  }
  const all = walk(start, () => true);
  const kept = walk(start, (u) => !isCut(u));
  const hidden = new Set([...all].filter((id) => !kept.has(id)));
  if (hidden.size === 0 && shut.every((c) => (branches.get(c)?.size ?? 0) === 0)) {
    return { graph, hiddenCount: new Map(shut.map((c) => [c, 0])), hiddenBy: new Map() };
  }

  const hiddenCount = new Map<string, number>();
  const hiddenBy = new Map<string, string[]>();
  for (const [c, branch] of branches) {
    const mine = [...branch].filter((id) => hidden.has(id));
    hiddenCount.set(c, mine.length);
    for (const id of mine) push(hiddenBy, id, c);
  }
  const persons = graph.persons.filter((p) => !hidden.has(p.id));
  const links = graph.links.filter((l) => !hidden.has(l.childId));
  const unions = graph.unions.filter(
    (u) =>
      [u.partnerAId, u.partnerBId].some((p) => p !== null && present.has(p) && !hidden.has(p)) ||
      links.some((l) => l.unionId === u.id),
  );
  return { graph: { ...graph, persons, unions, links }, hiddenCount, hiddenBy };
}
