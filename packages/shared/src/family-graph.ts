import type { DeleteMode } from './people.js';

/** Live rows only: non-deleted people, unions and links whose union and child are live. */
export interface LiveGraph {
  persons: readonly { id: string }[];
  unions: readonly GraphUnion[];
  parentChild: readonly GraphLink[];
}
export interface GraphUnion {
  id: string;
  partnerAId: string | null;
  partnerBId: string | null;
  /** Groups siblings whose parents are unknown (brief #11); kept with no partner. */
  parentsUnknown?: boolean;
}
export interface GraphLink {
  id: string;
  unionId: string;
  childId: string;
}

export const partnersOf = (u: GraphUnion): string[] =>
  [u.partnerAId, u.partnerBId].filter((p): p is string => p !== null);

/** The can() ends of a union: its partners, or its children when it has none (brief #11). */
export const unionEnds = (u: GraphUnion, childIds: readonly string[]): string[] =>
  partnersOf(u).length > 0 ? partnersOf(u) : [...childIds];

const add = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

function indexGraph(graph: LiveGraph) {
  const unionById = new Map(graph.unions.map((u) => [u.id, u]));
  const unionsOf = new Map<string, GraphUnion[]>();
  const linksByUnion = new Map<string, GraphLink[]>();
  const linksByChild = new Map<string, GraphLink[]>();
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const u of graph.unions) for (const p of partnersOf(u)) add(unionsOf, p, u);
  for (const l of graph.parentChild) {
    const u = unionById.get(l.unionId);
    if (!u) continue;
    add(linksByUnion, l.unionId, l);
    add(linksByChild, l.childId, l);
    for (const p of partnersOf(u)) {
      add(children, p, l.childId);
      add(parents, l.childId, p);
    }
  }
  return { unionById, unionsOf, linksByUnion, linksByChild, children, parents };
}

function reach(start: string, next: Map<string, string[]>): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
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

/** `id` and everyone above it, through any kind of parent–child link. */
export const ancestorsOf = (graph: LiveGraph, id: string) => reach(id, indexGraph(graph).parents);
/** `id` and everyone below it. */
export const descendantsOf = (graph: LiveGraph, id: string) =>
  reach(id, indexGraph(graph).children);

/** Whether making every `parentIds` a parent of every `childIds` would make someone their own ancestor. */
export function wouldCycle(graph: LiveGraph, parentIds: string[], childIds: string[]): boolean {
  const { children } = indexGraph(graph);
  return childIds.some((c) => {
    const below = reach(c, children);
    return parentIds.some((p) => below.has(p));
  });
}

/** Whether the live graph contains a parent–child cycle (a restore check, decision 7). */
export function hasCycle(graph: LiveGraph): boolean {
  const { children } = indexGraph(graph);
  const state = new Map<string, 1 | 2>(); // 1 = on the current path, 2 = done
  for (const p of graph.persons) {
    if (state.has(p.id)) continue;
    state.set(p.id, 1);
    const stack = [{ id: p.id, next: 0 }];
    for (let top = stack.at(-1); top; top = stack.at(-1)) {
      const kids = children.get(top.id) ?? [];
      const c = kids[top.next++];
      if (c === undefined) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const s = state.get(c);
      if (s === 1) return true;
      if (s === undefined) {
        state.set(c, 1);
        stack.push({ id: c, next: 0 });
      }
    }
  }
  return false;
}

export interface DeletionSlot {
  unionId: string;
  slot: 'a' | 'b';
  personId: string;
}

export interface DeletionPlan {
  /** People to soft-delete; for a person delete the target comes first. */
  personIds: string[];
  /** Unions to soft-delete (no partner left, or the deleted relation itself). */
  unionIds: string[];
  parentChildIds: string[];
  /** Partner slots to empty on unions whose other partner survives. */
  slots: DeletionSlot[];
  /** Every person the delete touches: the can() target (decision 5). */
  touchedPersonIds: string[];
}

/** Spec §4 "Deleting a person", as a plan over the live graph. `personId` must be in it. */
export function planPersonDeletion(
  graph: LiveGraph,
  personId: string,
  mode: DeleteMode,
): DeletionPlan {
  const ix = indexGraph(graph);
  const doomed = new Set([personId]);
  if (mode === 'descendants') {
    for (const d of reach(personId, ix.children)) doomed.add(d);
    const otherOf = (u: GraphUnion, self: string) =>
      u.partnerAId === self ? u.partnerBId : u.partnerAId;
    // Only partners of the descendants qualify; the root's own partners stay (spec §4).
    const rootPartners = new Set((ix.unionsOf.get(personId) ?? []).flatMap((u) => partnersOf(u)));
    const loners: string[] = [];
    for (const d of doomed) {
      if (d === personId) continue;
      for (const u of ix.unionsOf.get(d) ?? []) {
        const x = otherOf(u, d);
        if (x === null || doomed.has(x) || rootPartners.has(x) || ix.linksByChild.has(x)) continue;
        const allInside = (ix.unionsOf.get(x) ?? []).every((v) => {
          const o = otherOf(v, x);
          return o !== null && doomed.has(o);
        });
        if (allInside) loners.push(x);
      }
    }
    for (const x of loners) doomed.add(x);
  }

  const unionIds: string[] = [];
  const links = new Set<string>();
  const slots: DeletionSlot[] = [];
  const touched = new Set(doomed);
  for (const u of graph.unions) {
    const a = u.partnerAId !== null && doomed.has(u.partnerAId);
    const b = u.partnerBId !== null && doomed.has(u.partnerBId);
    const kids = ix.linksByUnion.get(u.id) ?? [];
    const keptKids = kids.some((l) => !doomed.has(l.childId));
    if (!a && !b) {
      // A parents-unknown union goes with its last child (brief #11): it is never left childless.
      if (u.parentsUnknown && partnersOf(u).length === 0 && kids.length > 0 && !keptKids) {
        unionIds.push(u.id);
        for (const l of kids) links.add(l.id);
      }
      continue;
    }
    for (const p of partnersOf(u)) touched.add(p);
    for (const l of kids) touched.add(l.childId);
    // A parents-unknown union outlives its partners while it still holds a child.
    const survivor =
      (u.partnerAId !== null && !a) ||
      (u.partnerBId !== null && !b) ||
      (u.parentsUnknown === true && keptKids);
    if (!survivor) {
      unionIds.push(u.id);
      for (const l of kids) links.add(l.id);
    } else {
      if (a) slots.push({ unionId: u.id, slot: 'a', personId: u.partnerAId! });
      if (b) slots.push({ unionId: u.id, slot: 'b', personId: u.partnerBId! });
    }
  }
  for (const d of doomed) {
    for (const l of ix.linksByChild.get(d) ?? []) {
      links.add(l.id);
      for (const p of partnersOf(ix.unionById.get(l.unionId)!)) touched.add(p);
    }
  }
  const rest = [...doomed].filter((id) => id !== personId).sort();
  return {
    personIds: [personId, ...rest],
    unionIds,
    parentChildIds: [...links],
    slots,
    touchedPersonIds: [...touched],
  };
}

/** Deleting a union also removes its child links (decision 4). */
export function planUnionDeletion(graph: LiveGraph, unionId: string): DeletionPlan {
  const ix = indexGraph(graph);
  const u = ix.unionById.get(unionId);
  if (!u) throw new Error('union is not in the graph');
  const links = ix.linksByUnion.get(unionId) ?? [];
  return {
    personIds: [],
    unionIds: [unionId],
    parentChildIds: links.map((l) => l.id),
    slots: [],
    touchedPersonIds: [...new Set([...partnersOf(u), ...links.map((l) => l.childId)])],
  };
}

export function planLinkDeletion(graph: LiveGraph, linkId: string): DeletionPlan {
  const ix = indexGraph(graph);
  const l = graph.parentChild.find((x) => x.id === linkId);
  if (!l) throw new Error('link is not in the graph');
  const u = ix.unionById.get(l.unionId)!;
  // The last child link of a partnerless parents-unknown union takes the union with it (brief #11).
  const last = (ix.linksByUnion.get(u.id) ?? []).every((x) => x.id === linkId);
  return {
    personIds: [],
    unionIds: u.parentsUnknown && partnersOf(u).length === 0 && last ? [u.id] : [],
    parentChildIds: [linkId],
    slots: [],
    touchedPersonIds: [l.childId, ...partnersOf(u)],
  };
}
