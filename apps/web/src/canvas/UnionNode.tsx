import { Handle, type NodeProps, Position } from '@xyflow/react';
import { useCanvasActions } from './CanvasActions';
import type { UnionFlowNode } from './graph-to-flow';

/** The small dot between partners (spec §6 "Union node ●"); clicking edits the union. */
export function UnionNode({ data }: NodeProps<UnionFlowNode>) {
  const actions = useCanvasActions();
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className="card-handle" />
      <button
        type="button"
        className={`union-dot nodrag${data.ended ? ' is-ended' : ''}`}
        aria-label={data.label}
        title={data.label}
        onClick={() => actions.openUnion(data.union.id)}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="card-handle"
      />
    </>
  );
}
