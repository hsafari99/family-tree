import type { TreeLink } from '@family-tree/shared';
import { useState } from 'react';
import { XIcon } from '../../components/icons';

export const seenLinksKey = (treeId: string) => `ft.seenLinks.${treeId}`;

function readSeen(treeId: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(seenLinksKey(treeId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeSeen(treeId: string, ids: readonly string[]) {
  try {
    localStorage.setItem(seenLinksKey(treeId), JSON.stringify(ids));
  } catch {
    // Blocked storage: the banner comes back next time, which is harmless.
  }
}

/**
 * Over the canvas: "Now linked with …" once per live link per browser, until dismissed (tree
 * linking spec, Web: canvas), and "This link has ended" when an unfolded link went away.
 */
export function LinkedNotice({
  treeId,
  links,
  ended,
  onDismissEnded,
}: {
  treeId: string;
  links: readonly TreeLink[];
  ended: string | null;
  onDismissEnded: () => void;
}) {
  const [seen, setSeen] = useState(() => ({ treeId, ids: readSeen(treeId) }));
  const ids = seen.treeId === treeId ? seen.ids : readSeen(treeId);
  const fresh = links.find((l) => l.status === 'live' && !ids.includes(l.id));
  const dismiss = (id: string) => {
    const next = [...ids, id];
    writeSeen(treeId, next);
    setSeen({ treeId, ids: next });
  };
  return (
    <>
      {ended && (
        <p role="status" className="notice linked-banner">
          <span>This link has ended. The other tree is no longer shown.</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss: this link has ended"
            title="Dismiss"
            onClick={onDismissEnded}
          >
            <XIcon />
          </button>
        </p>
      )}
      {fresh && (
        <p className="notice linked-banner">
          <span>
            Now linked with the {fresh.otherTree.name} tree through {fresh.bridge.name}. Public
            details are visible across both trees. Use the ⊕ on {fresh.bridge.name}’s card to show
            it.
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Dismiss: now linked with ${fresh.otherTree.name}`}
            title="Dismiss"
            onClick={() => dismiss(fresh.id)}
          >
            <XIcon />
          </button>
        </p>
      )}
    </>
  );
}
