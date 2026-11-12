import { CARD_HEIGHT, type CanvasNode } from './graph-to-flow';

/** A generation row's name, relative to the anchor (the focus person, or "me" in Full view). */
export function generationLabel(offset: number, self = 'You'): string {
  if (offset === 0) return self;
  const n = Math.abs(offset);
  const word = offset < 0 ? 'parents' : 'children';
  if (n === 1) return offset < 0 ? 'Parents' : 'Children';
  if (n === 2) return `Grand${word}`;
  if (n === 3) return `Great-grand${word}`;
  return `${n - 2}× great-grand${word}`;
}

export interface RowTop {
  generation: number;
  /** The top of the row's cards, in flow units. */
  y: number;
}

/** Each generation row's top, from the laid-out cards (Task 14); none without generations. */
export function rowTops(
  nodes: readonly CanvasNode[],
  generations: ReadonlyMap<string, number> | null,
): RowTop[] {
  if (!generations) return [];
  const tops = new Map<number, number>();
  for (const n of nodes) {
    if (n.type !== 'person') continue;
    const g = generations.get(n.id.slice(2));
    if (g === undefined) continue;
    tops.set(g, Math.min(tops.get(g) ?? Infinity, n.position.y));
  }
  return [...tops]
    .map(([generation, y]) => ({ generation, y }))
    .sort((a, b) => a.generation - b.generation);
}

export interface Band {
  label: string;
  top: number;
  bottom: number;
  /** Where the row's cards start. */
  cardsTop: number;
}

/** Room above the first row and below the last. */
const EDGE = 40;

/** The bands behind the rows: each reaches halfway to its neighbours, with its label. */
export function bandRows(
  rows: readonly RowTop[],
  generations: ReadonlyMap<string, number> | null,
  anchorId: string | null,
  self: string,
): Band[] {
  const anchor = anchorId === null ? undefined : generations?.get(anchorId);
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    return {
      label:
        anchor === undefined
          ? `Generation ${r.generation + 1}`
          : generationLabel(r.generation - anchor, self),
      top: prev ? (prev.y + CARD_HEIGHT + r.y) / 2 : r.y - EDGE,
      bottom: next ? (r.y + CARD_HEIGHT + next.y) / 2 : r.y + CARD_HEIGHT + EDGE,
      cardsTop: r.y,
    };
  });
}
