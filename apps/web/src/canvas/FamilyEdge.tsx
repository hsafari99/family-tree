import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { childPath, partnerPath } from './family-path';

/**
 * Every family line: a straight partner line into a dot on the partner row, otherwise an elbow
 * down a shared rail (children, and partners whose dot sits below the row). The classNames
 * (edge-partner, edge-child, edge-<kind>, edge-ended, edge-path) sit on React Flow's wrapper.
 */
export function FamilyEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceHandleId,
  markerEnd,
  style,
  interactionWidth,
}: EdgeProps) {
  const side = sourceHandleId === 'left' || sourceHandleId === 'right';
  const path = side
    ? partnerPath(sourceX, sourceY, targetX, targetY)
    : childPath(sourceX, sourceY, targetX, targetY);
  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      style={style}
      {...(interactionWidth === undefined ? {} : { interactionWidth })}
    />
  );
}
