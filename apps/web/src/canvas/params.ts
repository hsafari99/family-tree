import { GRAPH_DEPTH_MAX, type GraphMode } from '@family-tree/shared';
import { useSearchParams } from 'react-router';

export interface CanvasParams {
  mode: GraphMode;
  depth: number;
  branch: string | null;
  focus: string | null;
}

/** Decision 10: the canvas state lives in the URL. The server validates ids. */
export function readCanvasParams(p: URLSearchParams): CanvasParams {
  const depth = Number(p.get('depth'));
  return {
    mode: p.get('view') === 'full' ? 'full' : 'focus',
    depth: Number.isInteger(depth) && depth >= 1 && depth <= GRAPH_DEPTH_MAX ? depth : 1,
    branch: p.get('branch') || null,
    focus: p.get('focus') || null,
  };
}

export type CanvasChange = Partial<
  Record<'view' | 'depth' | 'branch' | 'focus' | 'tab' | 'add', string | number | null>
>;

/** `?…` with `change` applied to `current`; null removes a key, and default values are left out. */
export function canvasSearch(current: URLSearchParams, change: CanvasChange): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(change)) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, String(v));
  }
  if (next.get('view') === 'focus') next.delete('view');
  if (next.get('depth') === '1') next.delete('depth');
  const s = next.toString();
  return s ? `?${s}` : '';
}

/** A link to someone's panel that keeps the current view and depth. */
export function usePersonHref(treeId: string): (personId: string) => string {
  const [params] = useSearchParams();
  return (personId) =>
    `/trees/${treeId}/people/${personId}${canvasSearch(params, { focus: null, tab: null, add: null })}`;
}
