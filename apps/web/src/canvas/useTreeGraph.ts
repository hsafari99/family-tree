import type { GraphQuery, TreeGraph } from '@family-tree/shared';
import type { Edge } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { MESSAGES } from '../auth/api';
import { useTreesApi } from '../trees/TreesApiContext';
import { applyElkLayout, toElkGraph } from './elk-graph';
import { assignGenerations } from './generations';
import { type CanvasNode, type Family, graphToFlow } from './graph-to-flow';
import { useLayoutEngine } from './LayoutEngineContext';
import { LayoutTimeoutError } from './layout-engine';

export type TreeGraphState =
  | { status: 'loading' }
  | { status: 'error'; message: string; timedOut?: boolean }
  | { status: 'ready'; graph: TreeGraph; nodes: CanvasNode[]; edges: Edge[]; families: Family[] };

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
  const { mode, focus, depth, branch } = query;
  const { focusId, meId } = ctx;

  useEffect(() => {
    let active = true;
    // Keep showing the old drawing while a refresh loads; only the first load shows "loading".
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    void (async () => {
      const res = await api.getGraph(treeId, { mode, focus, depth, branch });
      if (!active) return;
      if (!res.ok) return setState({ status: 'error', message: res.error.message });
      const flow = graphToFlow(res.data, { focusId, meId });
      try {
        const laid = await engine.layout(toElkGraph(flow, assignGenerations(flow)));
        if (!active) return;
        setState({
          status: 'ready',
          graph: res.data,
          nodes: applyElkLayout(flow.nodes, laid),
          edges: flow.edges,
          families: flow.families,
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
    };
  }, [api, engine, treeId, mode, focus, depth, branch, focusId, meId, refreshKey]);

  return state;
}
