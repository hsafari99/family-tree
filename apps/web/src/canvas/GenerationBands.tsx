import { type ReactFlowState, useStore, ViewportPortal } from '@xyflow/react';
import { cardDetail } from './canvas-settings';
import type { Band } from './generation-labels';

/** Wide enough to fill the pane sideways at any zoom the canvas allows. */
const REACH = 200_000;

/** The label's height and a little air, in px. */
const LABEL_ROOM = 20;

const transformOf = (s: ReactFlowState) => s.transform;

/**
 * Faint alternating bands behind the generation rows, and their names pinned to the pane's left
 * edge (Task 14). Decorative: the cards say who is who. Hidden at the dot zoom.
 */
export function GenerationBands({ bands }: { bands: readonly Band[] }) {
  const [, ty, zoom] = useStore(transformOf);
  if (bands.length === 0 || cardDetail(zoom) === 'dot') return null;
  return (
    <>
      <ViewportPortal>
        <div className="generation-bands" aria-hidden="true">
          {bands.map((b, i) => (
            <div
              key={b.top}
              className={i % 2 === 0 ? 'generation-band is-shaded' : 'generation-band'}
              style={{
                transform: `translate(${-REACH / 2}px, ${b.top}px)`,
                width: REACH,
                height: b.bottom - b.top,
              }}
            />
          ))}
        </div>
      </ViewportPortal>
      <div className="generation-labels" aria-hidden="true">
        {/* In the strip above the row's cards, never over them; left out when it doesn't fit. */}
        {bands.map((b) =>
          (b.cardsTop - b.top) * zoom < LABEL_ROOM ? null : (
            <span key={b.top} className="generation-label" style={{ top: b.top * zoom + ty + 2 }}>
              {b.label}
            </span>
          ),
        )}
      </div>
    </>
  );
}
