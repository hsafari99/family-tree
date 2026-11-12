import { type ReactFlowState, useStore, ViewportPortal } from '@xyflow/react';
import { cardDetail } from './canvas-settings';
import { type Band, gutterLabels } from './generation-labels';

/** Wide enough to fill the pane sideways at any zoom the canvas allows. */
const REACH = 200_000;

const transformOf = (s: ReactFlowState) => s.transform;

/**
 * Faint alternating bands behind the generation rows (Task 14), inside the flow. Decorative: the
 * cards say who is who. Hidden at the dot zoom.
 */
export function GenerationBands({ bands }: { bands: readonly Band[] }) {
  const zoom = useStore(transformOf)[2];
  if (bands.length === 0 || cardDetail(zoom) === 'dot') return null;
  return (
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
  );
}

/**
 * The generations' names in a narrow column beside the pane, outside the flow, so a label never
 * covers a card whatever the zoom or pan. Each is centred on its band. Read from the flow's store,
 * so it must sit inside the ReactFlowProvider.
 */
export function GenerationGutter({ bands }: { bands: readonly Band[] }) {
  const [, ty, zoom] = useStore(transformOf);
  return <GutterLabels bands={bands} ty={ty} zoom={zoom} />;
}

/** The gutter at a given view (split out for tests). */
export function GutterLabels({
  bands,
  ty,
  zoom,
}: {
  bands: readonly Band[];
  ty: number;
  zoom: number;
}) {
  return (
    <div className="generation-gutter" aria-hidden="true">
      {gutterLabels(bands, ty, zoom).map((l) => (
        <div
          key={l.label}
          className={l.shaded ? 'generation-gutter-band is-shaded' : 'generation-gutter-band'}
          style={{ top: l.top, height: l.height }}
        >
          <span className="generation-label">{l.label}</span>
        </div>
      ))}
    </div>
  );
}
