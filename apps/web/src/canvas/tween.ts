import type { CanvasNode } from './graph-to-flow';

export type XY = { x: number; y: number };

/** Fast at first, settling gently: 1 − (1 − t)³, with t clamped to 0..1. */
export const easeOutCubic = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
};

export const positionsOf = (nodes: readonly CanvasNode[]): Map<string, XY> =>
  new Map(nodes.map((n) => [n.id, n.position]));

/**
 * The frame at time t (0..1) of moving from the old positions to the new layout `to`. A node with
 * no old position starts at its final place and is marked `is-entering` (the CSS fades it in); a
 * node not in `to` is dropped.
 */
export function tweenPositions(
  from: ReadonlyMap<string, XY>,
  to: readonly CanvasNode[],
  t: number,
): CanvasNode[] {
  const k = easeOutCubic(t);
  return to.map((n) => {
    const a = from.get(n.id);
    if (!a) return { ...n, className: n.className ? `${n.className} is-entering` : 'is-entering' };
    const b = n.position;
    if (a.x === b.x && a.y === b.y) return n;
    return { ...n, position: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k } };
  });
}
