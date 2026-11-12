import { type PointerEvent, useCallback, useRef, useState } from 'react';

/** A swipe this long (px) moves the sheet a step; a shorter one springs back. */
export const SWIPE_STEP = 80;
/** Past this the gesture is a drag, and the click that ends it doesn't toggle. */
const DRAG_SLOP = 8;

/**
 * Pointer swipes on the phone sheet's handle (Task 15): up and down past SWIPE_STEP call `onUp` or
 * `onDown`; while dragging, `drag` is how far it has moved (down is positive) so the sheet can
 * follow the finger. `swallowClick()` says whether the click ending a drag should be ignored.
 */
export function useSheetSwipe({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
  const start = useRef<{ id: number; y: number } | null>(null);
  const dragged = useRef(false);
  const [drag, setDrag] = useState(0);
  const end = (e: PointerEvent<HTMLElement>, apply: boolean) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    start.current = null;
    setDrag(0);
    const dy = e.clientY - s.y;
    if (!apply) return;
    if (dy > SWIPE_STEP) onDown();
    else if (dy < -SWIPE_STEP) onUp();
  };
  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (!e.isPrimary || e.button !== 0) return;
      start.current = { id: e.pointerId, y: e.clientY };
      dragged.current = false;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // No capture (a synthetic event): the moves still reach the handle while over it.
      }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const dy = e.clientY - s.y;
      if (Math.abs(dy) > DRAG_SLOP) dragged.current = true;
      if (dragged.current) setDrag(dy);
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, true),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, false),
  };
  const swallowClick = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);
  return { handlers, drag, swallowClick };
}
