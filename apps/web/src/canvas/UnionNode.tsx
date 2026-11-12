import { Handle, type NodeProps, Position } from '@xyflow/react';
import { useCanvasActions } from './CanvasActions';
import type { UnionFlowNode } from './graph-to-flow';

const SIDE = { top: Position.Top, left: Position.Left, right: Position.Right } as const;

/** The small dot between partners (spec §6 "Union node ●"); clicking edits the union. */
export function UnionNode({ data }: NodeProps<UnionFlowNode>) {
  const actions = useCanvasActions();
  return (
    <>
      {/* Partner lines come in at the top (dot below the row) or a side (dot on the row). */}
      {(['top', 'left', 'right'] as const).map((id) => (
        <Handle
          key={id}
          type="target"
          id={id}
          position={SIDE[id]}
          isConnectable={false}
          className="card-handle"
        />
      ))}
      <button
        type="button"
        className={`union-dot nodrag${data.ended ? ' is-ended' : ''}`}
        aria-label={data.label}
        title={data.label}
        onClick={() => actions.openUnion(data.union.id)}
      />
      {/* A child's line can be dropped here to move them to these parents (brief #13). Nobody
          can start a brand-new line from a dot. */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        isConnectable={data.union.canEdit}
        isConnectableStart={false}
        isConnectableEnd={data.union.canEdit}
        className="card-handle"
      />
    </>
  );
}
