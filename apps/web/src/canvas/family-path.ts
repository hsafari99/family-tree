/** SVG paths for the family lines (genealogy style). Pure, so the shapes are unit-tested. */

/** A partner's line: straight, from the side of their card to the union dot. */
export const partnerPath = (sx: number, sy: number, tx: number, ty: number) =>
  `M ${sx} ${sy} L ${tx} ${ty}`;

/**
 * A child's line: down from the dot to a rail halfway to the child's row, across to above the
 * child, then down, with rounded corners. Siblings share the rail's y, so it reads as one bus.
 */
export function childPath(sx: number, sy: number, tx: number, ty: number, r = 12): string {
  const dx = tx - sx;
  if (dx === 0) return `M ${sx} ${sy} L ${tx} ${ty}`;
  const rail = sy + (ty - sy) / 2;
  const k = Math.min(r, Math.abs(dx) / 2, Math.abs(rail - sy));
  const s = Math.sign(dx);
  return [
    `M ${sx} ${sy}`,
    `L ${sx} ${rail - k}`,
    `Q ${sx} ${rail} ${sx + s * k} ${rail}`,
    `L ${tx - s * k} ${rail}`,
    `Q ${tx} ${rail} ${tx} ${rail + k}`,
    `L ${tx} ${ty}`,
  ].join(' ');
}
