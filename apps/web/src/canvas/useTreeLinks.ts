import type { LinkedGraph, TreeLink } from '@family-tree/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTreesApi } from '../trees/TreesApiContext';
import type { BridgeMarker } from './linked';

export const openLinksKey = (treeId: string) => `ft.openLinks.${treeId}`;

function read(treeId: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(openLinksKey(treeId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(treeId: string, ids: readonly string[]) {
  try {
    if (ids.length === 0) localStorage.removeItem(openLinksKey(treeId));
    else localStorage.setItem(openLinksKey(treeId), JSON.stringify(ids));
  } catch {
    // Blocked storage: unfolding still works, it just isn't remembered.
  }
}

export interface TreeLinks {
  /** Live and pending links, as the server lists them for this member. */
  links: TreeLink[];
  /** The unfolded live links' graphs, fetched. */
  graphs: LinkedGraph[];
  /** Changes whenever `graphs` does, for effect dependencies. */
  graphsKey: string;
  /** Markers per bridge card. */
  markers: Map<string, BridgeMarker[]>;
  toggle: (linkId: string) => void;
  /** Unfolds a link (a search pick in a linked tree). */
  show: (linkId: string) => void;
  /** A link that ended while unfolded (its graph read came back 404). */
  ended: string | null;
  dismissEnded: () => void;
  reload: () => void;
}

/**
 * The tree's links and which ones are unfolded on the canvas (tree linking spec L7): open ids are
 * remembered per tree in the browser, and a linked tree's graph is fetched only while unfolded.
 */
export function useTreeLinks(treeId: string, refreshKey: number): TreeLinks {
  const api = useTreesApi();
  const [links, setLinks] = useState<TreeLink[]>([]);
  const [openIds, setOpenIds] = useState(() => ({ treeId, ids: read(treeId) }));
  const [graphs, setGraphs] = useState<{ key: string; list: LinkedGraph[] }>({ key: '', list: [] });
  const [ended, setEnded] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const open = openIds.treeId === treeId ? openIds.ids : read(treeId);

  useEffect(() => {
    if (openIds.treeId !== treeId) setOpenIds({ treeId, ids: read(treeId) });
  }, [openIds.treeId, treeId]);

  useEffect(() => {
    let active = true;
    void api.listLinks(treeId).then((r) => {
      if (active) setLinks(r.ok ? r.data : []);
    });
    return () => {
      active = false;
    };
  }, [api, treeId, refreshKey, reloads]);

  const live = useMemo(() => links.filter((l) => l.status === 'live'), [links]);
  const wanted = useMemo(
    () => live.filter((l) => open.includes(l.id)).map((l) => l.id),
    [live, open],
  );
  const wantedKey = wanted.join(',');

  useEffect(() => {
    let active = true;
    const ids = wantedKey ? wantedKey.split(',') : [];
    void Promise.all(ids.map((id) => api.linkedGraph(treeId, id))).then((results) => {
      if (!active) return;
      const list: LinkedGraph[] = [];
      let gone = false;
      results.forEach((r, i) => {
        if (r.ok) list.push(r.data);
        else if (r.error.code === 'NOT_FOUND') {
          gone = true;
          setEnded(ids[i]!);
        }
      });
      // Nothing unfolded before or now: keep the key, so the canvas doesn't lay out again.
      setGraphs((prev) =>
        prev.list.length === 0 && list.length === 0
          ? prev
          : { key: `${treeId}/${wantedKey}/${refreshKey}/${reloads}`, list },
      );
      // An ended link is gone from the list on the next read.
      if (gone) setReloads((n) => n + 1);
    });
    return () => {
      active = false;
    };
  }, [api, treeId, wantedKey, refreshKey, reloads]);

  const update = useCallback(
    (next: (ids: string[]) => string[]) =>
      setOpenIds((s) => {
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
    (id: string) => update((ids) => (ids.includes(id) ? ids : [...ids, id])),
    [update],
  );

  const markers = useMemo(() => {
    const m = new Map<string, BridgeMarker[]>();
    for (const l of live) {
      const list = m.get(l.bridge.personId) ?? [];
      list.push({
        linkId: l.id,
        treeName: l.otherTree.name,
        count: l.otherPeopleCount,
        open: open.includes(l.id),
      });
      m.set(l.bridge.personId, list);
    }
    return m;
  }, [live, open]);

  return {
    links,
    graphs: graphs.list,
    graphsKey: graphs.key,
    markers,
    toggle,
    show,
    ended,
    dismissEnded: useCallback(() => setEnded(null), []),
    reload: useCallback(() => setReloads((n) => n + 1), []),
  };
}
