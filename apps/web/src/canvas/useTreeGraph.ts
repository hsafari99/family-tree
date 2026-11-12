import type { GraphQuery, TreeGraph } from '@family-tree/shared';
import type { Edge } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../auth/api';
import { useTreesApi } from '../trees/TreesApiContext';
import { applyElkLayout, partnerHandles, toElkGraph } from './elk-graph';
import { assignGenerations } from './generations';
import type { Couple } from './couples';
import { type CanvasNode, type Family, graphToFlow } from './graph-to-flow';
import { useLayoutEngine } from './LayoutEngineContext';
import { LayoutTimeoutError } from './layout-engine';

export type TreeGraphState =
  | { status: 'loading' }
  | { status: 'error'; message: string; timedOut?: boolean }
  | {
      status: 'ready';
      treeId: string;
      graph: TreeGraph;
      nodes: CanvasNode[];
      edges: Edge[];
      families: Family[];
      couples: Couple[];
      /** A new number for each layout, so the canvas refits only on a new layout. */
      layoutKey: number;
    };

/** Fetches the graph, maps it, lays it out. Stale responses are dropped. */
export function useTreeGraph(
  treeId: string,
  query: GraphQuery,
  ctx: { focusId: string | null; meId: string | null },
  refreshKey: number,
): TreeGraphState {
  const api = useTreesApi();
  const engine = useLayoutEngine();
  const [state, setState] = useState<TreeGraphState>({ status: 'loading' });
  const layouts = useRef(0);
  const { mode, focus, depth, branch } = query;
  const { focusId, meId } = ctx;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    // Keep showing the old drawing while a refresh of the same tree loads; a different tree (or
    // the first load) shows "loading".
    setState((s) => (s.status === 'ready' && s.treeId === treeId ? s : { status: 'loading' }));
    void (async () => {
      const res = await api.getGraph(treeId, { mode, focus, depth, branch }, controller.signal);
      if (!active) return;
      if (!res.ok) return setState({ status: 'error', message: res.error.message });
      const flow = graphToFlow(res.data, { focusId, meId });
      if (!active) return;
      try {
        const laid = await engine.layout(toElkGraph(flow, assignGenerations(flow)));
        if (!active) return;
        const nodes = applyElkLayout(flow.nodes, laid, flow.couples, flow.blood);
        setState({
          status: 'ready',
          treeId,
          graph: res.data,
          nodes,
          edges: partnerHandles(nodes, flow.edges),
          families: flow.families,
          couples: flow.couples,
          layoutKey: ++layouts.current,
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
  }, [api, engine, treeId, mode, focus, depth, branch, focusId, meId, refreshKey]);

  // The first render after a tree change must not show the previous tree's drawing.
  return state.status === 'ready' && state.treeId !== treeId ? { status: 'loading' } : state;
}
