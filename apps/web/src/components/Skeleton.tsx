import type { CSSProperties } from 'react';

const px = (v: number | string | undefined) => (typeof v === 'number' ? `${v}px` : v);

/**
 * A placeholder block while something loads: a soft --surface-2 shape that shimmers when motion
 * is allowed. Decorative; the loading region beside it keeps its own "Loading…" text.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = 'var(--radius-s)',
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width: px(width), height: px(height), borderRadius: px(radius), ...style }}
    />
  );
}

/** Home's tree cards while the summary loads. */
export function TreeCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="tree-cards" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tree-card tree-card-skeleton">
          <Skeleton width="65%" height={20} />
          <Skeleton width="45%" height={14} />
          <Skeleton width={72} height={36} />
        </div>
      ))}
    </div>
  );
}

/** The canvas while the tree is drawn: a few faint cards joined by family lines. */
export function CanvasSkeleton() {
  const card = (x: number, y: number) => (
    <rect x={x} y={y} width="150" height="56" rx="12" className="skeleton-shape" />
  );
  return (
    <div className="canvas-skeleton" aria-hidden="true">
      <svg viewBox="0 0 520 260" width="520" height="260" focusable="false">
        <g className="skeleton-line">
          <path d="M175 48h170M260 48v52M260 100H105v52M260 100h155v52" />
        </g>
        {card(20, 20)}
        {card(350, 20)}
        <circle cx="260" cy="48" r="6" className="skeleton-shape" />
        {card(30, 152)}
        {card(185, 152)}
        {card(340, 152)}
      </svg>
    </div>
  );
}
