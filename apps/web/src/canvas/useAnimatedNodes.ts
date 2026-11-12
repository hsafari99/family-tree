import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { CanvasNode } from './graph-to-flow';
import { positionsOf, tweenPositions, type XY } from './tween';

/** Above this many nodes a layout change jumps: a frame of hundreds of moves would stutter. */
export const ANIMATE_BELOW = 400;

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const samePlaces = (a: ReadonlyMap<string, XY>, nodes: readonly CanvasNode[]) =>
  a.size === nodes.length &&
  nodes.every((n) => {
    const p = a.get(n.id);
    return p !== undefined && p.x === n.position.x && p.y === n.position.y;
  });

/**
 * The nodes to draw: on a new layout the cards glide from where they were to their new places
 * (ease-out, `duration` ms), new ones fade in and gone ones drop. It jumps straight to the end on
 * the first layout, with reduced motion, at ANIMATE_BELOW nodes or more, and when nothing moved (a
 * class-only change). `settled()` resolves once the current move has finished, so a fit can wait
 * for the final bounds. `setShown` is for React Flow's own changes (a drag) and its snap-back.
 */
export function useAnimatedNodes(
  nodes: CanvasNode[],
  { duration = 320 }: { duration?: number } = {},
): {
  shown: CanvasNode[];
  setShown: Dispatch<SetStateAction<CanvasNode[]>>;
  settled: () => Promise<void>;
} {
  const [shown, setShown] = useState(nodes);
  // Where each node is drawn right now (mid-move too), so an interrupted move carries on from there.
  const at = useRef<Map<string, XY> | null>(null);
  const done = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const from = at.current;
    const jump = () => {
      setShown(nodes);
      at.current = positionsOf(nodes);
      done.current = Promise.resolve();
    };
    if (!from || reducedMotion() || nodes.length >= ANIMATE_BELOW || samePlaces(from, nodes)) {
      return jump();
    }
    let finish = () => {};
    done.current = new Promise((resolve) => (finish = resolve));
    let start: number | null = null;
    let frame = 0;
    const step = (now: number) => {
      start ??= now;
      const t = (now - start) / duration;
      if (t >= 1) {
        jump();
        return finish();
      }
      const next = tweenPositions(from, nodes, t);
      at.current = positionsOf(next);
      setShown(next);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      finish();
    };
  }, [nodes, duration]);

  const settled = useCallback(() => done.current, []);
  return { shown, setShown, settled };
}
