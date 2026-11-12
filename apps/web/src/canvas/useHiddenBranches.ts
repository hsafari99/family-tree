import { useCallback, useEffect, useMemo, useState } from 'react';

export const hiddenBranchesKey = (treeId: string) => `ft.hiddenBranches.${treeId}`;

function read(treeId: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(hiddenBranchesKey(treeId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(treeId: string, ids: readonly string[]) {
  try {
    if (ids.length === 0) localStorage.removeItem(hiddenBranchesKey(treeId));
    else localStorage.setItem(hiddenBranchesKey(treeId), JSON.stringify(ids));
  } catch {
    // Blocked storage: the collapse still works, it just isn't remembered.
  }
}

/**
 * The people whose descendants are hidden on the canvas (Task 13), remembered per tree. Ids of
 * people not in the drawing are kept (they may be in another view) and ignored by collapseGraph.
 */
export function useHiddenBranches(treeId: string): {
  hidden: ReadonlySet<string>;
  toggle: (personId: string) => void;
  /** Expands these (a search pick inside a collapsed branch). */
  show: (personIds: readonly string[]) => void;
} {
  const [state, setState] = useState(() => ({ treeId, ids: read(treeId) }));
  // Another tree: read its own list.
  const current = state.treeId === treeId ? state : { treeId, ids: read(treeId) };
  useEffect(() => {
    if (state.treeId !== treeId) setState({ treeId, ids: read(treeId) });
  }, [state.treeId, treeId]);
  const ids = current.ids;
  const hidden = useMemo(() => new Set(ids), [ids]);
  const update = useCallback(
    (next: (ids: string[]) => string[]) =>
      setState((s) => {
        const base = s.treeId === treeId ? s.ids : read(treeId);
        const out = next(base);
        write(treeId, out);
        return { treeId, ids: out };
      }),
    [treeId],
  );
  const toggle = useCallback(
    (id: string) =>
      update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
    [update],
  );
  const show = useCallback(
    (remove: readonly string[]) => update((ids) => ids.filter((x) => !remove.includes(x))),
    [update],
  );
  return { hidden, toggle, show };
}
