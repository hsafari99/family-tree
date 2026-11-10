import {
  applyNodeChanges,
  Background,
  Controls,
  type Edge,
  MiniMap,
  type NodeChange,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type CanvasActions, CanvasActionsProvider, SelectionProvider } from './CanvasActions';
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
import { PersonNode } from './PersonCard';
import { UnionNode } from './UnionNode';

const NODE_TYPES = { person: PersonNode, union: UnionNode } satisfies NodeTypes;

export interface FamilyCanvasProps {
  nodes: CanvasNode[];
  edges: Edge[];
  families: Family[];
  /** Centred after each layout in focus view; null in full view. */
  focusId: string | null;
  actions: Omit<CanvasActions, 'reveal'>; // keep it referentially stable
  /** The open person; read through a store so a change doesn't re-render every card. */
  selectedId: string | null;
  /** Sibling drag (Task 17). */
  onReorder?: (unionId: string, childIds: string[]) => void;
}

export function FamilyCanvas(props: FamilyCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({
  nodes,
  edges,
  families,
  focusId,
  actions,
  selectedId,
  onReorder,
}: FamilyCanvasProps) {
  const flow = useReactFlow<CanvasNode>();
  const pane = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(nodes);
  useEffect(() => setShown(nodes), [nodes]);
  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => setShown((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  // After every new layout: fit, then (focus view) centre on the focus person.
  useEffect(() => {
    if (nodes.length === 0) return;
    void (async () => {
      await flow.fitView({ padding: 0.15, maxZoom: 1.1, duration: 0 });
      const focus = focusId ? nodes.find((n) => n.id === personNodeId(focusId)) : undefined;
      if (focus) {
        await flow.setCenter(
          focus.position.x + CARD_WIDTH / 2,
          focus.position.y + CARD_HEIGHT / 2,
          {
            zoom: flow.getViewport().zoom,
            duration: 0,
          },
        );
      }
    })();
  }, [flow, nodes, focusId]);

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
      if (node.type !== 'person' || !node.data.reorderUnionId || !onReorder) return;
      const next = reorderAfterDrop(families, node.data.reorderUnionId, x);
      if (next) onReorder(node.data.reorderUnionId, next);
    },
    [flow, families, nodes, onReorder],
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
  const ctx = useMemo(() => ({ ...actions, reveal }), [actions, reveal]);
  const settings = canvasSettings(nodes.length);

  return (
    <CanvasActionsProvider value={ctx}>
      <SelectionProvider value={selection}>
        <div className="family-canvas" ref={pane}>
          <ReactFlow<CanvasNode>
            nodes={shown}
            edges={edges}
            nodeTypes={NODE_TYPES}
            colorMode="system"
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            onlyRenderVisibleElements={settings.onlyRenderVisibleElements}
            minZoom={0.05}
            maxZoom={2}
            aria-label="Family tree"
          >
            <Background />
            <Controls showInteractive={false} />
            {settings.showMiniMap && <MiniMap pannable zoomable ariaLabel="Overview of the tree" />}
          </ReactFlow>
        </div>
      </SelectionProvider>
    </CanvasActionsProvider>
  );
}
