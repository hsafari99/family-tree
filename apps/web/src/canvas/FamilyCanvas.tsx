import {
  applyNodeChanges,
  Background,
  type Connection,
  type Edge,
  type EdgeTypes,
  BackgroundVariant,
  MiniMap,
  type NodeChange,
  type NodeTypes,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type CanvasActions, CanvasActionsProvider, SelectionProvider } from './CanvasActions';
import { type Couple, type CoupleChange, coupleChangeAfterDrop } from './couples';
import { createSelectionStore } from './selection';
import { canvasSettings, isNodeVisible, reorderAfterDrop } from './canvas-settings';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  type CanvasNode,
  type PersonFlowNode,
  type Family,
  personNodeId,
} from './graph-to-flow';
import { CanvasToolbar, motionMs, useMiniMapShown } from './CanvasToolbar';
import { FamilyEdge } from './FamilyEdge';
import { type NavDirection, neighbour } from './keyboard-nav';
import { PersonNode } from './PersonCard';
import { reparentFromReconnect } from './reparent';
import { UnionNode } from './UnionNode';
import { useAnimatedNodes } from './useAnimatedNodes';

const NODE_TYPES = { person: PersonNode, union: UnionNode } satisfies NodeTypes;
const EDGE_TYPES = { family: FamilyEdge } satisfies EdgeTypes;

export interface FamilyCanvasProps {
  nodes: CanvasNode[];
  edges: Edge[];
  families: Family[];
  /** Shown couples, for swapping sides and ordering partners by drag (brief #16). */
  couples?: Couple[];
  /**
   * Changes with each new layout (useTreeGraph's ready state): the canvas refits only then, never
   * for a class-only change (highlight, lineage). Without it, every new `nodes` array refits.
   */
  layoutKey?: number;
  /** Centred after each layout in focus view; null in full view. */
  focusId: string | null;
  actions: Omit<CanvasActions, 'reveal' | 'flyTo' | 'move'>; // keep it referentially stable
  /** The viewer's own person, for "Centre on me"; null when they have none in the tree. */
  meId?: string | null;
  /** A search pick to fly to; a new `seq` flies again (after the next layout if not shown yet). */
  flyRequest?: { personId: string; seq: number } | null;
  /** The open person; read through a store so a change doesn't re-render every card. */
  selectedId: string | null;
  /** Sibling drag (Task 17). */
  onReorder?: (unionId: string, childIds: string[]) => void;
  /** A child's line dropped on another union dot (brief #13). */
  onReparent?: (linkId: string, unionId: string) => void;
  /** A partner dragged past the other one, or an end of a chain past the hub (brief #16). */
  onCoupleChange?: (change: CoupleChange) => void;
}

export function FamilyCanvas(props: FamilyCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function CanvasInner({
  nodes,
  edges,
  families,
  focusId,
  actions,
  selectedId,
  onReorder,
  onReparent,
  couples,
  onCoupleChange,
  layoutKey,
  meId = null,
  flyRequest = null,
}: FamilyCanvasProps) {
  const flow = useReactFlow<CanvasNode>();
  const pane = useRef<HTMLDivElement>(null);
  // Cards glide to their new places on a new layout (Task 9); a fit waits until they have.
  const { shown, setShown, settled } = useAnimatedNodes(nodes);
  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => setShown((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  // Whether the person moved or zoomed the view since the last fit (then a resize keeps their place).
  const userMoved = useRef(false);
  const [mapChosen, toggleMap] = useMiniMapShown();
  const mapShown = canvasSettings(nodes.length).showMiniMap && mapChosen;
  // Read through a ref, so a class-only change of `nodes` doesn't make a new `fit` (and a refit).
  const latest = useRef({ nodes, focusId, mapShown });
  latest.current = { nodes, focusId, mapShown };
  /** Fit the drawing, then (focus view) centre on the focus person. */
  const fit = useCallback(async () => {
    const { nodes, focusId, mapShown } = latest.current;
    // Keep the drawing clear of the toolbar (right edge) and of the minimap above its bottom
    // corner, so no card sits under them.
    const padding = {
      top: 0.1,
      left: 0.1,
      right: '64px' as const,
      bottom: mapShown ? ('176px' as const) : 0.1,
    };
    await flow.fitView({ padding, maxZoom: 1.1, duration: 0 });
    const focus = focusId ? nodes.find((n) => n.id === personNodeId(focusId)) : undefined;
    if (focus) {
      await flow.setCenter(focus.position.x + CARD_WIDTH / 2, focus.position.y + CARD_HEIGHT / 2, {
        zoom: flow.getViewport().zoom,
        duration: 0,
      });
    }
    userMoved.current = false;
  }, [flow]);

  /** Pans and zooms (to at least 0.9) so the person's card is in the middle (Task 10). */
  const flyTo = useCallback(
    (personId: string): boolean => {
      const node = flow.getNode(personNodeId(personId));
      if (!node) return false;
      userMoved.current = true; // a resize keeps them in the middle rather than refitting
      void flow.setCenter(node.position.x + CARD_WIDTH / 2, node.position.y + CARD_HEIGHT / 2, {
        zoom: Math.max(flow.getViewport().zoom, 0.9),
        duration: motionMs(450),
      });
      return true;
    },
    [flow],
  );
  const pendingFly = useRef<string | null>(null);
  const flySeq = flyRequest?.seq;
  const flyId = flyRequest?.personId;
  useEffect(() => {
    if (flyId === undefined) return;
    // Not drawn yet (a new layout is coming): fly after it has been fitted.
    if (!flyTo(flyId)) pendingFly.current = flyId;
  }, [flySeq, flyId, flyTo]);

  const layoutId = layoutKey ?? nodes;
  // After every new layout, and when the canvas changes width (the panel opening or closing beside
  // it): fit again, unless the person has moved the view since, in which case keep what was in the
  // middle in the middle.
  useEffect(() => {
    if (latest.current.nodes.length === 0) return;
    let cancelled = false;
    // Let React Flow take the new nodes and its new size, and measure them, first (two frames):
    // fitting earlier used the previous bounds and could crop the drawing.
    const refit = async () => {
      await nextFrame();
      await settled();
      await nextFrame();
      await nextFrame();
      if (cancelled) return;
      await fit();
      // A search pick that wasn't drawn yet: fly once the new layout is in.
      const pending = pendingFly.current;
      pendingFly.current = null;
      if (pending) flyTo(pending);
    };
    void refit();
    const el = pane.current;
    if (!el || typeof ResizeObserver === 'undefined') return () => void (cancelled = true);
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      const next = el.clientWidth;
      const before = width;
      width = next;
      if (next === before || before === 0 || next === 0) return;
      if (!userMoved.current) return void refit();
      const vp = flow.getViewport();
      void flow.setViewport({ ...vp, x: vp.x + (next - before) / 2 });
    });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [flow, layoutId, fit, settled, flyTo]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: CanvasNode) => {
      // Read the dragged positions first; setShown applies on the next render.
      const x = new Map(
        flow
          .getNodes()
          .filter((n): n is PersonFlowNode => n.type === 'person')
          .map((n) => [n.data.person.id, n.position.x]),
      );
      setShown(nodes); // snap back; the next layout puts the card in its new place
      if (node.type !== 'person') return;
      if (node.data.reorderUnionId) {
        const next = onReorder && reorderAfterDrop(families, node.data.reorderUnionId, x);
        if (next) onReorder(node.data.reorderUnionId, next);
      } else if (node.data.coupleDrag && couples && onCoupleChange) {
        const at = new Map([...x].map(([id, px]) => [personNodeId(id), px]));
        const change = coupleChangeAfterDrop(couples, node.id, at);
        if (change) onCoupleChange(change);
      }
    },
    [flow, families, nodes, onReorder, couples, onCoupleChange, setShown],
  );

  // No local edge update: the reload after the API call redraws them.
  const onReconnect = useCallback(
    (old: Edge, c: Connection) => {
      const r = reparentFromReconnect(old, c);
      if (r) onReparent?.(r.linkId, r.unionId);
    },
    [onReparent],
  );
  const isValidConnection = useCallback(
    (c: Edge | Connection) => c.source.startsWith('u:') && c.target.startsWith('p:'),
    [],
  );

  const reveal = useCallback(
    (personId: string) => {
      const node = flow.getNode(personNodeId(personId));
      const el = pane.current;
      if (!node || !el) return;
      const vp = flow.getViewport();
      const size = { width: CARD_WIDTH, height: CARD_HEIGHT };
      if (
        !isNodeVisible(node.position, size, vp, { width: el.clientWidth, height: el.clientHeight })
      ) {
        void flow.setCenter(node.position.x + CARD_WIDTH / 2, node.position.y + CARD_HEIGHT / 2, {
          zoom: vp.zoom,
          duration: 150,
        });
      }
    },
    [flow],
  );
  const [selection] = useState(() => createSelectionStore(selectedId));
  useEffect(() => selection.set(selectedId), [selection, selectedId]);
  const flyToPerson = useCallback((id: string) => void flyTo(id), [flyTo]);
  // Arrow keys (Task 12): focus the relative's card and pan to it; Enter still opens it.
  const familiesRef = useRef(families);
  familiesRef.current = families;
  const move = useCallback(
    (personId: string, dir: NavDirection) => {
      const positions = new Map(
        latest.current.nodes
          .filter((n): n is PersonFlowNode => n.type === 'person')
          .map((n) => [n.data.person.id, n.position]),
      );
      const to = neighbour(dir, personId, familiesRef.current, positions);
      if (!to) return;
      const find = () =>
        pane.current?.querySelector<HTMLElement>(`.card-open[data-person-id="${CSS.escape(to)}"]`);
      reveal(to);
      const el = find();
      if (el) return el.focus();
      // Not rendered (only the visible part of a large tree is): focus it once it is drawn.
      void nextFrame()
        .then(nextFrame)
        .then(() => find()?.focus());
    },
    [reveal],
  );
  const ctx = useMemo(
    () => ({ ...actions, reveal, flyTo: flyToPerson, move }),
    [actions, reveal, flyToPerson, move],
  );
  const settings = canvasSettings(nodes.length);

  return (
    <CanvasActionsProvider value={ctx}>
      <SelectionProvider value={selection}>
        <div className="family-canvas" ref={pane}>
          <ReactFlow<CanvasNode>
            nodes={shown}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            colorMode="system"
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onMoveStart={(e) => {
              // Only a person's pan or zoom has an event; our own fitView has none.
              if (e) userMoved.current = true;
            }}
            edgesReconnectable={false}
            onReconnect={onReparent ? onReconnect : undefined}
            isValidConnection={isValidConnection}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            onlyRenderVisibleElements={settings.onlyRenderVisibleElements}
            minZoom={0.05}
            maxZoom={2}
            aria-label="Family tree. Use arrow keys to move between relatives, Enter to open."
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
            <Panel position="bottom-right">
              <CanvasToolbar
                canCentreMe={meId !== null && nodes.some((n) => n.id === personNodeId(meId))}
                onFit={() => void fit()}
                onCentreMe={() => meId && flyTo(meId)}
                map={{ available: settings.showMiniMap, shown: mapShown, toggle: toggleMap }}
              />
            </Panel>
            {mapShown && (
              <MiniMap
                className="canvas-minimap"
                position="bottom-right"
                pannable
                zoomable
                ariaLabel="Overview of the tree"
              />
            )}
          </ReactFlow>
        </div>
      </SelectionProvider>
    </CanvasActionsProvider>
  );
}
