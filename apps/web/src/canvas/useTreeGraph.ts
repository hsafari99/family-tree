import type { GraphQuery, LinkedGraph, TreeGraph } from '@family-tree/shared';
import type { Edge } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../auth/api';
import { useTreesApi } from '../trees/TreesApiContext';
import { applyElkLayout, partnerHandles, toElkGraph } from './elk-graph';
import { collapseGraph } from './collapse';
import { type RowTop, rowTops } from './generation-labels';
import { assignGenerations } from './generations';
import type { Couple } from './couples';
import { type CanvasNode, type Family, type Flow, graphToFlow } from './graph-to-flow';
import { useLayoutEngine } from './LayoutEngineContext';
import { LayoutTimeoutError } from './layout-engine';
import { type BridgeMarker, mergeLinked } from './linked';

export type TreeGraphState =
  | { status: 'loading' }
  | { status: 'error'; message: string; timedOut?: boolean }
  | {
      status: 'ready';
      treeId: string;
      /** The fetched graph, less any collapsed branches. */
      graph: TreeGraph;
      nodes: CanvasNode[];
      edges: Edge[];
      families: Family[];
      couples: Couple[];
      /** A new number for each layout, so the canvas refits only on a new layout. */
      layoutKey: number;
      /** Per hidden person: the collapsed people hiding them (Task 13). */
      hiddenBy: Map<string, string[]>;
      /** Each person's generation row (null when no consistent rows exist), and each row's top. */
      generations: Map<string, number> | null;
      rows: RowTop[];
    };

const NONE: ReadonlySet<string> = new Set();
const NO_MARKERS: ReadonlyMap<string, BridgeMarker[]> = new Map();

/** Fetches the graph, maps it, lays it out. Stale responses are dropped. */
export function useTreeGraph(
  treeId: string,
  query: GraphQuery,
  ctx: {
    focusId: string | null;
    meId: string | null;
    /** Collapsed people (Task 13), and who to keep when hiding (the root in full view). */
    hidden?: ReadonlySet<string>;
    anchorId?: string | null;
    /** False for the fan and the tree, which draw the graph themselves: no layout, no nodes. */
    layout?: boolean;
    /** Unfolded linked trees (tree linking spec), drawn off their bridge cards; `linkedKey`
     *  changes whenever they do. */
    linked?: readonly LinkedGraph[];
    linkedKey?: string;
    /** Linked-tree markers per bridge card. */
    markers?: ReadonlyMap<string, BridgeMarker[]>;
  },
  refreshKey: number,
): TreeGraphState {
  const api = useTreesApi();
  const engine = useLayoutEngine();
  const [state, setState] = useState<TreeGraphState>({ status: 'loading' });
  const layouts = useRef(0);
  const { mode, focus, depth, generations, branch } = query;
  const { focusId, meId, hidden = NONE, anchorId = null, layout = true } = ctx;
  // Read through refs: the keys below say when they changed.
  const linked = useRef(ctx.linked ?? []);
  linked.current = ctx.linked ?? [];
  const markers = useRef(ctx.markers ?? NO_MARKERS);
  markers.current = ctx.markers ?? NO_MARKERS;
  const linkedKey = layout ? (ctx.linkedKey ?? '') : '';
  const markersKey = [...(ctx.markers ?? NO_MARKERS).values()]
    .flat()
    .map((m) => `${m.linkId}:${m.open}:${m.count}`)
    .join(',');
  // A string, so a new Set with the same ids doesn't lay out again.
  const hiddenKey = [...hidden].sort().join('\n');
  // The last response: collapsing or expanding a branch lays out again without fetching.
  const fetched = useRef<{ key: string; data: TreeGraph } | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    // Keep showing the old drawing while a refresh of the same tree loads; a different tree (or
    // the first load) shows "loading".
    setState((s) => (s.status === 'ready' && s.treeId === treeId ? s : { status: 'loading' }));
    void (async () => {
      const key = JSON.stringify([treeId, mode, focus, depth, generations, branch, refreshKey]);
      let data = fetched.current?.key === key ? fetched.current.data : null;
      if (!data) {
        const res = await api.getGraph(
          treeId,
          { mode, focus, depth, generations, branch },
          controller.signal,
        );
        if (!active) return;
        if (!res.ok) return setState({ status: 'error', message: res.error.message });
        data = res.data;
        fetched.current = { key, data };
      }
      const shut = new Set(hiddenKey ? hiddenKey.split('\n') : []);
      const joined = layout ? mergeLinked(data, linked.current) : data;
      const cut = collapseGraph(joined, shut, focusId ?? anchorId);
      const flow = graphToFlow(cut.graph, { focusId, meId });
      markBranches(flow, shut, cut.hiddenCount);
      for (const n of flow.nodes) {
        if (n.type === 'person' && !n.data.person.linkedTree) {
          n.data.links = markers.current.get(n.data.person.id) ?? [];
        }
      }
      if (!active) return;
      if (!layout) {
        return setState({
          status: 'ready',
          treeId,
          graph: cut.graph,
          nodes: [],
          edges: [],
          families: flow.families,
          couples: [],
          layoutKey: ++layouts.current,
          hiddenBy: cut.hiddenBy,
          generations: null,
          rows: [],
        });
      }
      try {
        const generations = assignGenerations(flow);
        const laid = await engine.layout(toElkGraph(flow, generations));
        if (!active) return;
        const nodes = applyElkLayout(flow.nodes, laid, flow.couples, flow.blood);
        setState({
          status: 'ready',
          treeId,
          graph: cut.graph,
          nodes,
          edges: partnerHandles(nodes, flow.edges),
          families: flow.families,
          couples: flow.couples,
          layoutKey: ++layouts.current,
          hiddenBy: cut.hiddenBy,
          generations,
          rows: rowTops(nodes, generations),
        });
      } catch (err) {
        if (!active) return;
        setState(
          err instanceof LayoutTimeoutError
            ? { status: 'error', message: MESSAGES.layoutTooSlow, timedOut: true }
            : { status: 'error', message: MESSAGES.layoutFailed },
        );
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    api,
    engine,
    treeId,
    mode,
    focus,
    depth,
    generations,
    branch,
    focusId,
    meId,
    refreshKey,
    hiddenKey,
    layout,
    anchorId,
    linkedKey,
    markersKey,
  ]);

  // The first render after a tree change must not show the previous tree's drawing.
  return state.status === 'ready' && state.treeId !== treeId ? { status: 'loading' } : state;
}

/** Each card's collapse chevron: collapsed people show a count, parents with children an arrow. */
export function markBranches(
  flow: Flow,
  collapsed: ReadonlySet<string>,
  hiddenCount: ReadonlyMap<string, number>,
): void {
  const parents = new Set(
    flow.families.filter((f) => f.childIds.length > 0).flatMap((f) => f.partnerIds),
  );
  for (const n of flow.nodes) {
    if (n.type !== 'person') continue;
    const id = n.data.person.id;
    const count = hiddenCount.get(id) ?? 0;
    n.data.branch =
      collapsed.has(id) && (count > 0 || parents.has(id))
        ? { collapsed: true, hidden: count }
        : parents.has(id)
          ? { collapsed: false }
          : null;
  }
}
