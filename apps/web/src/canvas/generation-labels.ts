import { cardDetail } from './canvas-settings';
import { CARD_HEIGHT, type CanvasNode } from './graph-to-flow';

/**
 * A generation row's name, relative to the anchor: it names the generation, not the people in it.
 * `anchorName` is the anchor's first name, or null when the anchor is you.
 */
export function generationLabel(offset: number, anchorName: string | null = null): string {
  if (offset === 0) return anchorName ? `${anchorName}’s generation` : 'Your generation';
  const n = Math.abs(offset);
  const up = offset < 0;
  const word = up ? 'parents’' : 'children’s';
  const kin =
    n === 1
      ? up
        ? 'Parents’'
        : 'Children’s'
      : n === 2
        ? `Grand${word}`
        : n === 3
          ? `Great-grand${word}`
          : `${n - 2}× great-grand${word}`;
  return `${kin} generation`;
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
  /** The anchor's first name, or null when the anchor is you. */
  anchorName: string | null,
): Band[] {
  const anchor = anchorId === null ? undefined : generations?.get(anchorId);
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    return {
      label:
        anchor === undefined
          ? `Generation ${r.generation + 1}`
          : generationLabel(r.generation - anchor, anchorName),
      top: prev ? (prev.y + CARD_HEIGHT + r.y) / 2 : r.y - EDGE,
      bottom: next ? (r.y + CARD_HEIGHT + next.y) / 2 : r.y + CARD_HEIGHT + EDGE,
      cardsTop: r.y,
    };
  });
}

export interface GutterLabel {
  label: string;
  /** The band's top and height on screen, in px from the pane's top. */
  top: number;
  height: number;
  /** Where the label's middle goes. */
  centre: number;
  shaded: boolean;
}

/**
 * The bands as the left gutter draws them at this view (`ty` and `zoom` of the transform): each
 * label centred on its band, at any zoom except the dot zoom, where there are none.
 */
export function gutterLabels(bands: readonly Band[], ty: number, zoom: number): GutterLabel[] {
  if (cardDetail(zoom) === 'dot') return [];
  return bands.map((b, i) => {
    const top = b.top * zoom + ty;
    const height = (b.bottom - b.top) * zoom;
    return { label: b.label, top, height, centre: top + height / 2, shaded: i % 2 === 0 };
  });
}
