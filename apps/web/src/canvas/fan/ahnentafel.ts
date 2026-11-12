import type { Sex, TreeGraph } from '@family-tree/shared';

/** The generation of an ahnentafel slot: 0 for the person (1), 1 for parents (2, 3)… */
export const slotGeneration = (n: number) => Math.floor(Math.log2(n));

/** Birth parents first, then adoptive, step and foster ones. */
const KIND_RANK = { biological: 0, adoptive: 1, step: 2, foster: 3 } as const;

/**
 * Ahnentafel numbers of the person's ancestors (Task 18): 1 is the person, 2n the father of n and
 * 2n+1 the mother. The parents come from the union they're a child of; a partner's sex places
 * them (male 2n, female 2n+1), otherwise partner A is 2n and B 2n+1.
 */
export function ahnentafel(graph: TreeGraph, rootId: string, gens: number): Map<number, string> {
  const sex = new Map(graph.persons.map((p) => [p.id, p.sex]));
  const unionById = new Map(graph.unions.map((u) => [u.id, u]));
  const parentsOf = (id: string): [string | null, string | null] => {
    const link = graph.links
      .filter((l) => l.childId === id)
      .map((l) => ({ l, u: unionById.get(l.unionId) }))
      .filter((x) => x.u && (x.u.partnerAId !== null || x.u.partnerBId !== null))
      .sort((x, y) => KIND_RANK[x.l.kind] - KIND_RANK[y.l.kind])[0];
    if (!link?.u) return [null, null];
    const live = (p: string | null) => (p !== null && sex.has(p) ? p : null);
    const a = live(link.u.partnerAId);
    const b = live(link.u.partnerBId);
    const male = (p: string | null) => p !== null && sex.get(p) === 'male';
    const female = (p: string | null) => p !== null && sex.get(p) === 'female';
    if (male(b) || female(a)) return [b, a];
    if (!a && b && !male(b) && !female(b)) return [b, null];
    return [a, b];
  };
  const out = new Map<number, string>();
  if (!sex.has(rootId)) return out;
  out.set(1, rootId);
  const seen = new Set([rootId]);
  let frontier = [1];
  for (let g = 0; g < gens; g++) {
    const next: number[] = [];
    for (const n of frontier) {
      const [father, mother] = parentsOf(out.get(n)!);
      for (const [slot, id] of [
        [2 * n, father],
        [2 * n + 1, mother],
      ] as const) {
        if (id === null || seen.has(id)) continue;
        seen.add(id);
        out.set(slot, id);
        next.push(slot);
      }
    }
    frontier = next;
  }
  return out;
}

const bySex = (sex: Sex, m: string, f: string, n: string) =>
  sex === 'male' ? m : sex === 'female' ? f : n;

/** "Father", "Grandmother, father's side", "2× great-grandparent, mother's side"… */
export function slotRelation(n: number, sex: Sex): string {
  const g = slotGeneration(n);
  const base = bySex(sex, 'father', 'mother', 'parent');
  const word =
    g <= 1
      ? base
      : g === 2
        ? `grand${base}`
        : g === 3
          ? `great-grand${base}`
          : `${g - 2}× great-grand${base}`;
  const cap = word[0]!.toUpperCase() + word.slice(1);
  if (g <= 1) return cap;
  return `${cap}, ${slotSide(n) === 'pat' ? 'father’s' : 'mother’s'} side`;
}

/** Which side of the family a slot is on: through the father (2) or the mother (3). */
export function slotSide(n: number): 'pat' | 'mat' {
  const g = slotGeneration(n);
  return n - 2 ** g < 2 ** (g - 1) ? 'pat' : 'mat';
}
