import type { Connection, Edge } from '@xyflow/react';

/**
 * A dragged child-edge end dropped on another union dot -> the re-parent request, or null
 * (brief #13). The keyboard way is "Change parents…" in the Relations tab.
 */
export function reparentFromReconnect(
  old: Pick<Edge, 'id' | 'source' | 'target'>,
  c: Pick<Connection, 'source' | 'target'>,
): { linkId: string; unionId: string } | null {
  if (!old.id.startsWith('child:') || !c.source.startsWith('u:')) return null;
  if (c.source === old.source || c.target !== old.target) return null;
  return { linkId: old.id.slice('child:'.length), unionId: c.source.slice(2) };
}
