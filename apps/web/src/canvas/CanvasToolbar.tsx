import { useReactFlow } from '@xyflow/react';
import { useCallback, useState } from 'react';
import { FitIcon, MapIcon, TargetIcon, ZoomInIcon, ZoomOutIcon } from '../components/icons';

export const MINIMAP_KEY = 'ft.canvas.minimap';

const narrow = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches;

export const motionMs = (ms: number) =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : ms;

/** Whether the minimap shows: remembered, else on for a desktop and off on a phone. */
export function useMiniMapShown(): [boolean, () => void] {
  const [shown, setShown] = useState(() => {
    try {
      const v = localStorage.getItem(MINIMAP_KEY);
      if (v === '1' || v === '0') return v === '1';
    } catch {
      // Storage blocked: fall back to the default.
    }
    return !narrow();
  });
  const toggle = useCallback(() => {
    setShown((s) => {
      try {
        localStorage.setItem(MINIMAP_KEY, s ? '0' : '1');
      } catch {
        // Not remembered, still toggled.
      }
      return !s;
    });
  }, []);
  return [shown, toggle];
}

/**
 * The canvas's floating controls, a vertical pill in the bottom right (Task 10): zoom, fit,
 * centre on me, and the minimap toggle. Rendered inside React Flow.
 */
export function CanvasToolbar({
  canCentreMe,
  onFit,
  onCentreMe,
  map,
}: {
  canCentreMe: boolean;
  onFit: () => void;
  onCentreMe: () => void;
  map: { available: boolean; shown: boolean; toggle: () => void };
}) {
  const flow = useReactFlow();
  return (
    <div className="canvas-toolbar" role="group" aria-label="Canvas controls">
      <button
        type="button"
        className="canvas-tool"
        aria-label="Zoom in"
        data-tip="Zoom in"
        data-tip-side="left"
        onClick={() => void flow.zoomIn({ duration: motionMs(200) })}
      >
        <ZoomInIcon />
      </button>
      <button
        type="button"
        className="canvas-tool"
        aria-label="Zoom out"
        data-tip="Zoom out"
        data-tip-side="left"
        onClick={() => void flow.zoomOut({ duration: motionMs(200) })}
      >
        <ZoomOutIcon />
      </button>
      <button
        type="button"
        className="canvas-tool"
        aria-label="Fit tree"
        data-tip="Fit tree"
        data-tip-side="left"
        onClick={onFit}
      >
        <FitIcon />
      </button>
      <button
        type="button"
        className="canvas-tool"
        aria-label="Centre on me"
        data-tip="Centre on me"
        data-tip-side="left"
        disabled={!canCentreMe}
        onClick={onCentreMe}
      >
        <TargetIcon />
      </button>
      {map.available && (
        <button
          type="button"
          className="canvas-tool"
          // One name; aria-pressed says whether it is on (a changing name would say it twice).
          aria-label="Show map"
          data-tip="Show map"
          data-tip-side="left"
          aria-pressed={map.shown}
          onClick={map.toggle}
        >
          <MapIcon />
        </button>
      )}
    </div>
  );
}
