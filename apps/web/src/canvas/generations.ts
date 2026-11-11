import type { Family } from './graph-to-flow';

export interface GenerationInput {
  personIds: readonly string[];
  families: readonly Family[];
}

/**
 * A row per generation (decision 13): partners share a row (and so do siblings whose parents are
 * unknown), children sit one row below their
 * parents, and each couple is packed as low as possible (just above its highest child).
 * Returns null when no consistent rows exist (someone would be in their own parents' row).
 */
export function assignGenerations({
  personIds,
  families,
}: GenerationInput): Map<string, number> | null {
  if (personIds.length === 0) return new Map();
  // 1. Couples: everyone joined by a union shares one group (union-find).
  const parent = new Map(personIds.map((id) => [id, id]));
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const f of families) {
    for (const p of f.partnerIds.slice(1)) parent.set(find(p), find(f.partnerIds[0]!));
    // Siblings with unknown parents (brief #11) share a row too.
    if (f.partnerIds.length === 0) {
      for (const c of f.childIds.slice(1)) parent.set(find(c), find(f.childIds[0]!));
    }
  }
  // 2. Group edges: a family's couple sits above each of its children's groups.
  const below = new Map<string, Set<string>>();
  const above = new Map<string, Set<string>>();
  const link = (m: Map<string, Set<string>>, k: string, v: string) => {
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(v);
  };
  for (const f of families) {
    if (f.partnerIds.length === 0) continue;
    const g = find(f.partnerIds[0]!);
    for (const c of f.childIds) {
      const h = find(c);
      if (h === g) return null;
      link(below, g, h);
      link(above, h, g);
    }
  }
  // 3. Topological order (Kahn); leftovers mean a cycle.
  const groups = [...new Set(personIds.map(find))];
  const waiting = new Map(groups.map((g) => [g, above.get(g)?.size ?? 0]));
  const order: string[] = [];
  const queue = groups.filter((g) => waiting.get(g) === 0);
  for (let g = queue.shift(); g !== undefined; g = queue.shift()) {
    order.push(g);
    for (const h of below.get(g) ?? []) {
      const n = waiting.get(h)! - 1;
      waiting.set(h, n);
      if (n === 0) queue.push(h);
    }
  }
  if (order.length !== groups.length) return null;
  // 4. Longest path from the top, then pull each group down to just above its highest child.
  const gen = new Map<string, number>();
  for (const g of order) {
    gen.set(g, Math.max(0, ...[...(above.get(g) ?? [])].map((p) => gen.get(p)! + 1)));
  }
  for (const g of [...order].reverse()) {
    const kids = [...(below.get(g) ?? [])];
    if (kids.length > 0) gen.set(g, Math.min(...kids.map((k) => gen.get(k)!)) - 1);
  }
  const top = Math.min(...gen.values());
  return new Map(personIds.map((id) => [id, gen.get(find(id))! - top]));
}
