import { compareSiblings, type TreeGraph } from '@family-tree/shared';

/** Leaves sit this far apart, and generations this far apart (Task 19). */
export const SLOT = 150;
export const GEN_GAP = 135;
/** Room for each partner after the first beside a leaf. */
const PARTNER_ROOM = 42;
const MARGIN_X = 110;
const MARGIN_TOP = 100;
/** Under the root: the names, the trunk and the ground. */
const MARGIN_BOTTOM = 120;

interface FamilyNode {
  personId: string;
  partnerIds: string[];
  children: FamilyNode[];
  gen: number;
  x: number;
}

export interface TreeLayout {
  nodes: {
    personId: string;
    x: number;
    y: number;
    gen: number;
    partners: { id: string; x: number; y: number }[];
  }[];
  branches: { from: string; to: string; gen: number }[];
  width: number;
  height: number;
}

/**
 * The illustrated tree's layout: the root at the bottom, each generation of descendants one row
 * higher, children grouped by union (in the person's union order), leaves evenly spaced and every
 * parent centred over their children. Partners hang beside their person.
 */
export function descLayout(graph: TreeGraph, rootId: string, gens: number): TreeLayout {
  const byId = new Map(graph.persons.map((p) => [p.id, p]));
  const kids = new Map<string, string[]>();
  for (const l of graph.links) kids.set(l.unionId, [...(kids.get(l.unionId) ?? []), l.childId]);
  const sortKey = (id: string) => {
    const p = byId.get(id)!;
    return { siblingOrder: p.siblingOrder, birthYear: p.birthYear, givenName: p.givenName };
  };
  const seen = new Set<string>();
  const build = (personId: string, gen: number): FamilyNode => {
    seen.add(personId);
    const unions = graph.unions
      .filter((u) => u.partnerAId === personId || u.partnerBId === personId)
      .map((u) => ({
        u,
        order: (u.partnerAId === personId ? u.partnerAOrder : u.partnerBOrder) ?? Infinity,
      }))
      .sort((a, b) => a.order - b.order || a.u.id.localeCompare(b.u.id))
      .map((x) => x.u);
    const partnerIds: string[] = [];
    const children: FamilyNode[] = [];
    for (const u of unions) {
      const other = u.partnerAId === personId ? u.partnerBId : u.partnerAId;
      if (other && byId.has(other) && !seen.has(other) && !partnerIds.includes(other)) {
        partnerIds.push(other);
        seen.add(other);
      }
      if (gen >= gens) continue;
      const ids = (kids.get(u.id) ?? []).filter((id) => byId.has(id) && !seen.has(id));
      ids.sort((a, b) => compareSiblings(sortKey(a), sortKey(b)));
      for (const id of ids) if (!seen.has(id)) children.push(build(id, gen + 1));
    }
    return { personId, partnerIds, children, gen, x: 0 };
  };
  if (!byId.has(rootId)) return { nodes: [], branches: [], width: 0, height: 0 };
  const root = build(rootId, 0);

  let cursor = MARGIN_X;
  let maxGen = 0;
  const place = (n: FamilyNode) => {
    maxGen = Math.max(maxGen, n.gen);
    if (n.children.length === 0) {
      n.x = cursor;
      cursor += SLOT + Math.max(0, n.partnerIds.length - 1) * PARTNER_ROOM;
      return;
    }
    n.children.forEach(place);
    n.x = (n.children[0]!.x + n.children.at(-1)!.x) / 2;
  };
  place(root);

  const yOf = (gen: number) => MARGIN_TOP + (maxGen - gen) * GEN_GAP;
  const nodes: TreeLayout['nodes'] = [];
  const branches: TreeLayout['branches'] = [];
  let right = 0;
  const walk = (n: FamilyNode) => {
    const y = yOf(n.gen);
    const r = n.gen === 0 ? 30 : 25;
    const partners = n.partnerIds.map((id, i) => ({
      id,
      x: n.x + r + 20 + i * PARTNER_ROOM,
      y: y - 8,
    }));
    right = Math.max(right, n.x, ...partners.map((p) => p.x));
    nodes.push({ personId: n.personId, x: n.x, y, gen: n.gen, partners });
    for (const c of n.children) {
      branches.push({ from: n.personId, to: c.personId, gen: n.gen });
      walk(c);
    }
  };
  walk(root);
  return { nodes, branches, width: right + MARGIN_X, height: yOf(0) + MARGIN_BOTTOM };
}
