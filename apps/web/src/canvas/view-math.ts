/** Viewport arithmetic for keeping cards clear of what floats over the canvas. Screen values are in
 *  px relative to the pane's top-left; flow values in the drawing's own units. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
/** What covers the pane: the toolbar's column on the right, a sheet over the bottom (a phone), and
 *  floating boxes (the toolbar, the minimap). */
export interface Cover {
  right: number;
  bottom: number;
  boxes: readonly Rect[];
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Whether a card's screen box is wholly on the pane, above the sheet, and under no floating box. */
export function isClear(
  card: Rect,
  pane: { width: number; height: number },
  cover: Cover,
): boolean {
  return (
    card.x >= 0 &&
    card.y >= 0 &&
    card.x + card.width <= pane.width &&
    card.y + card.height <= pane.height - cover.bottom &&
    !cover.boxes.some((b) => overlaps(card, b))
  );
}

/** The viewport that puts flow point (x, y) in the middle of the uncovered part of the pane. */
export function centredOn(
  x: number,
  y: number,
  zoom: number,
  pane: { width: number; height: number },
  cover: Pick<Cover, 'right' | 'bottom'>,
): Viewport {
  const cx = Math.max(0, pane.width - cover.right) / 2;
  const cy = Math.max(0, pane.height - cover.bottom) / 2;
  return { x: cx - x * zoom, y: cy - y * zoom, zoom };
}

/** The viewport that keeps a flow point at the same screen place (a collapse keeps its card put). */
export const pinnedAt = (
  screen: { x: number; y: number },
  at: { x: number; y: number },
  zoom: number,
) => ({
  x: screen.x - at.x * zoom,
  y: screen.y - at.y * zoom,
  zoom,
});

/** A flow box on screen. */
export const onScreen = (box: Rect, vp: Viewport): Rect => ({
  x: box.x * vp.zoom + vp.x,
  y: box.y * vp.zoom + vp.y,
  width: box.width * vp.zoom,
  height: box.height * vp.zoom,
});

/**
 * The focus view's zoom after a fit: never below the name-and-years card, because it centres on
 * the focus person anyway and the rest is a pan away (a phone would otherwise get dots).
 */
export const FOCUS_MIN_ZOOM = 0.4;
export const focusZoom = (fitted: number, max = 1.1) =>
  Math.min(max, Math.max(fitted, FOCUS_MIN_ZOOM));
