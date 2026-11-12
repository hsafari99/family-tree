import { GRAPH_DEPTH_MAX, GRAPH_GENERATIONS_MAX, type GraphMode } from '@family-tree/shared';
import { useSearchParams } from 'react-router';

/** What the canvas area draws: the focus hourglass, the full chart, the fan chart or the tree. */
export const CANVAS_VIEWS = ['focus', 'full', 'fan', 'tree'] as const;
export type CanvasView = (typeof CANVAS_VIEWS)[number];
/** The fan's and the tree's generations when the URL has none. */
export const GENS_DEFAULT = 4;

export interface CanvasParams {
  view: CanvasView;
  /** The focus view's generations up and down. */
  depth: number;
  /** The fan's and the tree's generations. */
  gens: number;
  branch: string | null;
  focus: string | null;
}

const MODE_OF: Record<CanvasView, GraphMode> = {
  focus: 'focus',
  full: 'full',
  fan: 'ancestors',
  tree: 'descendants',
};
/** The graph a view draws from. */
export const graphModeOf = (view: CanvasView): GraphMode => MODE_OF[view];

const intIn = (raw: string | null, max: number, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
};

/** Decision 10: the canvas state lives in the URL. The server validates ids. */
export function readCanvasParams(p: URLSearchParams): CanvasParams {
  const view = p.get('view');
  return {
    view: CANVAS_VIEWS.find((v) => v === view) ?? 'focus',
    depth: intIn(p.get('depth'), GRAPH_DEPTH_MAX, 1),
    gens: intIn(p.get('gens'), GRAPH_GENERATIONS_MAX, GENS_DEFAULT),
    branch: p.get('branch') || null,
    focus: p.get('focus') || null,
  };
}

export type CanvasChange = Partial<
  Record<
    'view' | 'depth' | 'gens' | 'branch' | 'focus' | 'tab' | 'add' | 'from' | 'to',
    string | number | null
  >
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
  if (next.get('gens') === String(GENS_DEFAULT)) next.delete('gens');
  const s = next.toString();
  return s ? `?${s}` : '';
}

/** A link to someone's panel that keeps the current view and depth. */
export function usePersonHref(treeId: string): (personId: string) => string {
  const [params] = useSearchParams();
  return (personId) =>
    `/trees/${treeId}/people/${personId}${canvasSearch(params, { focus: null, tab: null, add: null, from: null, to: null })}`;
}
