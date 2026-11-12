import type { Family } from './graph-to-flow';

export type NavDirection = 'up' | 'down' | 'left' | 'right';
type XY = { x: number; y: number };

/** How far apart two cards' tops may be and still count as one row. */
const ROW_SLOP = 10;

function closestInX(ids: Iterable<string>, x: number, positions: ReadonlyMap<string, XY>) {
  let best: string | null = null;
  let gap = Infinity;
  for (const id of ids) {
    const p = positions.get(id);
    if (!p) continue;
    const d = Math.abs(p.x - x);
    if (d < gap) [best, gap] = [id, d];
  }
  return best;
}

/**
 * Where an arrow key goes from a person's card (Task 12): Up to their shown parent closest in x,
 * Down to their shown child closest in x, Left/Right to the nearest card in the same row that
 * way. Null when there is nobody there. `positions` holds the shown people only.
 */
export function neighbour(
  dir: NavDirection,
  personId: string,
  families: readonly Family[],
  positions: ReadonlyMap<string, XY>,
): string | null {
  const at = positions.get(personId);
  if (!at) return null;
  if (dir === 'up') {
    const parents = families
      .filter((f) => f.childIds.includes(personId))
      .flatMap((f) => f.partnerIds);
    return closestInX(parents, at.x, positions);
  }
  if (dir === 'down') {
    const kids = families.filter((f) => f.partnerIds.includes(personId)).flatMap((f) => f.childIds);
    return closestInX(kids, at.x, positions);
  }
  const sign = dir === 'right' ? 1 : -1;
  let best: string | null = null;
  let gap = Infinity;
  for (const [id, p] of positions) {
    if (id === personId || Math.abs(p.y - at.y) > ROW_SLOP) continue;
    const d = (p.x - at.x) * sign;
    if (d > 0 && d < gap) [best, gap] = [id, d];
  }
  return best;
}
