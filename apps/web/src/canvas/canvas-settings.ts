import type { Family } from './graph-to-flow';

export type CardDetail = 'full' | 'compact' | 'dot';
/** Spec §6: full card, then name and years, then a dot. */
export const cardDetail = (zoom: number): CardDetail =>
  zoom >= 0.55 ? 'full' : zoom >= 0.25 ? 'compact' : 'dot';

export const VISIBLE_ONLY_FROM = 300;
export const MINIMAP_MAX_NODES = 1500;
/** The client half of the performance guard (decision 4). */
export const canvasSettings = (nodeCount: number) => ({
  onlyRenderVisibleElements: nodeCount >= VISIBLE_ONLY_FROM,
  showMiniMap: nodeCount <= MINIMAP_MAX_NODES,
});

type Pt = { x: number; y: number };
type Size = { width: number; height: number };
/** Whether a node at flow position `pos` is wholly inside the pane at this viewport. */
export function isNodeVisible(pos: Pt, size: Size, vp: Pt & { zoom: number }, pane: Size): boolean {
  const left = pos.x * vp.zoom + vp.x;
  const top = pos.y * vp.zoom + vp.y;
  return (
    left >= 0 &&
    top >= 0 &&
    left + size.width * vp.zoom <= pane.width &&
    top + size.height * vp.zoom <= pane.height
  );
}

/** Children of one union in left-to-right order of their x positions (sibling drag, Task 17). */
export const orderAfterDrag = (childIds: readonly string[], x: ReadonlyMap<string, number>) =>
  [...childIds].sort((a, b) => (x.get(a) ?? 0) - (x.get(b) ?? 0));

/** The new child order after a drop, or null when nothing changed. */
export function reorderAfterDrop(
  families: readonly Family[],
  unionId: string,
  x: ReadonlyMap<string, number>,
): string[] | null {
  const fam = families.find((f) => f.id === unionId);
  if (!fam) return null;
  const next = orderAfterDrag(fam.childIds, x);
  return next.every((id, i) => id === fam.childIds[i]) ? null : next;
}
