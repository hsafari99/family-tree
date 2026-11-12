import { CARD_WIDTH } from './graph-to-flow';

export interface Couple {
  unionId: string;
  /** Node ids p:<id>, in slot order: a sits left of b unless the hub's union order says otherwise. */
  a: string;
  b: string;
  /** Each partner's own saved position for this union (partner_a_order, partner_b_order). */
  aOrder: number | null;
  bOrder: number | null;
}
type Pos = { x: number; y: number };

/** One person's couples in *their own* saved order (their slot's column), then by union id. */
const byOwnOrder = (p: string) => (m: Couple, n: Couple) => {
  const own = (c: Couple) => (c.a === p ? c.aOrder : c.bOrder) ?? Infinity;
  return own(m) - own(n) || (m.unionId < n.unionId ? -1 : m.unionId > n.unionId ? 1 : 0);
};
const other = (c: Couple, p: string) => (c.a === p ? c.b : c.a);

/**
 * Re-seats each row so partners sit side by side (brief #14). ELK gives the rows and rough x; this
 * keeps each couple chain together, orders chains by their leftmost blood member (so sibling order
 * between families holds), and packs them without overlap near ELK's x.
 * Mutates `pos` and returns how far it moved each person (node id -> dx).
 * `blood`: node ids of people shown as someone's child.
 */
export function seatCouples(
  pos: Map<string, Pos>,
  couples: readonly Couple[],
  blood: ReadonlySet<string>,
  gap: number,
): Map<string, number> {
  const moved = new Map<string, number>();
  const rowOf = (id: string) => Math.round(pos.get(id)!.y);
  const partners = new Map<string, Couple[]>();
  for (const c of couples) {
    if (!pos.has(c.a) || !pos.has(c.b) || rowOf(c.a) !== rowOf(c.b)) continue;
    for (const p of [c.a, c.b]) partners.set(p, [...(partners.get(p) ?? []), c]);
  }
  for (const [p, list] of partners) list.sort(byOwnOrder(p));

  const rows = new Map<number, string[]>();
  for (const id of pos.keys())
    if (id.startsWith('p:')) rows.set(rowOf(id), [...(rows.get(rowOf(id)) ?? []), id]);

  for (const ids of rows.values()) {
    ids.sort((m, n) => pos.get(m)!.x - pos.get(n)!.x);
    const seen = new Set<string>();
    const groups: string[][] = [];
    for (const start of ids) {
      if (seen.has(start)) continue;
      const comp: string[] = [];
      for (const q = [start]; q.length > 0;) {
        const p = q.pop()!;
        if (seen.has(p)) continue;
        seen.add(p);
        comp.push(p);
        for (const c of partners.get(p) ?? []) q.push(other(c, p));
      }
      groups.push(chain(comp));
    }
    const meanX = (g: string[]) => g.reduce((s, p) => s + pos.get(p)!.x, 0) / g.length;
    const key = (g: string[]) => {
      const kin = g.filter((p) => blood.has(p)).map((p) => pos.get(p)!.x);
      return kin.length > 0 ? Math.min(...kin) : meanX(g);
    };
    const keys = new Map(groups.map((g) => [g, key(g)]));
    groups.sort((g, h) => keys.get(g)! - keys.get(h)!);
    let cursor = -Infinity;
    for (const g of groups) {
      const width = g.length * CARD_WIDTH + (g.length - 1) * gap;
      const left = Math.max(meanX(g) - (width - CARD_WIDTH) / 2, cursor);
      g.forEach((p, i) => {
        const x = left + i * (CARD_WIDTH + gap);
        const dx = x - pos.get(p)!.x;
        if (dx !== 0) moved.set(p, dx);
        pos.set(p, { x, y: pos.get(p)!.y });
      });
      cursor = left + width + gap;
    }
  }
  return moved;

  /** Left-to-right seats for one couple component. */
  function chain(comp: string[]): string[] {
    if (comp.length === 1) return comp;
    if (comp.length === 2) {
      const c = partners.get(comp[0]!)![0]!;
      return [c.a, c.b];
    }
    // The person with the most partners sits in the middle: first union left, second right, …
    const hub = [...comp].sort(
      (m, n) => partners.get(n)!.length - partners.get(m)!.length || pos.get(m)!.x - pos.get(n)!.x,
    )[0]!;
    const out = [hub];
    partners
      .get(hub)!
      .forEach((c, i) => (i % 2 === 0 ? out.unshift(other(c, hub)) : out.push(other(c, hub))));
    // Partners of partners go on the outside next to them, when that end is free.
    for (let placed = true; placed;) {
      placed = false;
      for (const p of comp) {
        if (out.includes(p)) continue;
        const mate = (partners.get(p) ?? []).map((c) => other(c, p)).find((m) => out.includes(m));
        if (mate === undefined) continue;
        const at = out.indexOf(mate);
        if (at === 0) out.unshift(p);
        else if (at === out.length - 1) out.push(p);
        else out.splice(at + 1, 0, p); // three or more partners: only two can touch
        placed = true;
      }
    }
    return out;
  }
}

export type CoupleChange =
  { kind: 'swap'; unionId: string } | { kind: 'unionOrder'; personId: string; unionIds: string[] };

/**
 * What dropping a dragged card means (brief #16). `x`: each card's left edge, the dragged one where
 * it was dropped. Past its only partner, a couple swaps sides. An end of a chain dropped past the
 * hub (a partner with several couples) changes the hub's own order: the dragged couple trades
 * places with the nearest one on the other side. `unionIds` lists only the hub's couples given here
 * (those on screen); the API keeps the others where they are. Anything else: null (snap back).
 */
export function coupleChangeAfterDrop(
  couples: readonly Couple[],
  nodeId: string,
  x: ReadonlyMap<string, number>,
): CoupleChange | null {
  const of = (p: string) => couples.filter((c) => (c.a === p || c.b === p) && x.has(other(c, p)));
  const mine = of(nodeId);
  const at = x.get(nodeId);
  if (mine.length !== 1 || at === undefined) return null;
  const c = mine[0]!;
  const mate = other(c, nodeId);
  const mateX = x.get(mate)!;
  const hubs = of(mate).sort(byOwnOrder(mate));
  if (hubs.length === 1) {
    // A pair sits [a, b].
    const crossed = c.a === nodeId ? at > mateX : at < mateX;
    return crossed ? { kind: 'swap', unionId: c.unionId } : null;
  }
  // The hub seats its first couple left, second right, third left, …
  const i = hubs.indexOf(c);
  const left = i % 2 === 0;
  if (left ? at <= mateX : at >= mateX) return null;
  const j = left ? (i + 1 < hubs.length ? i + 1 : i - 1) : i - 1;
  const ids = hubs.map((h) => h.unionId);
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return { kind: 'unionOrder', personId: mate.slice(2), unionIds: ids };
}
