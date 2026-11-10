export interface FamilyGraph {
  persons: readonly { id: string; createdBy: string | null }[];
  unions: readonly { id: string; partnerAId: string | null; partnerBId: string | null }[];
  parentChild: readonly { unionId: string; childId: string }[];
}

function walk(start: Iterable<string>, next: Map<string, string[]>): Set<string> {
  const seen = new Set(start);
  const queue = [...seen];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const n of next.get(id) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

const push = (m: Map<string, string[]>, k: string, v: string) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

/**
 * The branch of `anchorId` (spec §4). Pure twin of the API's SQL `branchQuery`; both are tested
 * against BRANCH_CASES. `graph` must contain live rows only.
 */
export function branchOf(
  graph: FamilyGraph,
  anchorId: string,
  stewardUserId: string | null,
): Set<string> {
  const live = new Set(graph.persons.map((p) => p.id));
  const unionById = new Map(graph.unions.map((u) => [u.id, u]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const pc of graph.parentChild) {
    const u = unionById.get(pc.unionId);
    if (!u) continue;
    for (const p of [u.partnerAId, u.partnerBId]) {
      if (p === null) continue;
      push(parents, pc.childId, p);
      push(children, p, pc.childId);
    }
  }

  const ancestors = walk([anchorId], parents);
  const core = new Set([...walk(ancestors, children)].filter((id) => live.has(id)));
  const result = new Set(core);
  for (const u of graph.unions) {
    for (const [self, other] of [
      [u.partnerAId, u.partnerBId],
      [u.partnerBId, u.partnerAId],
    ] as const) {
      if (self !== null && other !== null && core.has(self) && live.has(other)) {
        if (!parents.has(other)) result.add(other);
      }
    }
  }
  if (stewardUserId !== null) {
    for (const p of graph.persons) if (p.createdBy === stewardUserId) result.add(p.id);
  }
  return result;
}
