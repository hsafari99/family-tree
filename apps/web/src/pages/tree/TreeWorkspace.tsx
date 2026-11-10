import type { GraphQuery, PersonSummary, RelativeRole, TreeDetail } from '@family-tree/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useMatch, useNavigate, useParams, useSearchParams } from 'react-router';
import { FormError } from '../../components/forms';
import { PhotoRefreshContext, useThrottled } from '../../components/PersonPhoto';
import { CanvasToolbar } from '../../canvas/CanvasToolbar';
import { FamilyCanvas } from '../../canvas/FamilyCanvas';
import {
  type CanvasChange,
  canvasSearch,
  readCanvasParams,
  usePersonHref,
} from '../../canvas/params';
import { useTreeGraph } from '../../canvas/useTreeGraph';
import { useTreesApi } from '../../trees/TreesApiContext';
import { AddPersonForm } from './AddPersonForm';
import { PeopleList } from './PeopleList';
import { PersonPanel } from './PersonPanel';
import { UnionPanel } from './UnionPanel';

export function TreeWorkspace({
  treeId,
  detail,
  persons,
  onPersonsChanged,
}: {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  onPersonsChanged: () => void;
}) {
  const { personId, unionId } = useParams();
  const newPerson = useMatch('/trees/:treeId/people/new') !== null;
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const api = useTreesApi();
  const hrefOf = usePersonHref(treeId);
  const view = readCanvasParams(params);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshPhotos = useThrottled(() => setRefreshKey((k) => k + 1));
  const [disconnected, setDisconnected] = useState<PersonSummary[]>([]);

  // Focus view centres on: an explicit focus, else the selected person, else the root (decision 10).
  const focusId = view.focus ?? personId ?? detail.tree.rootPersonId;
  const query: GraphQuery =
    view.mode === 'full'
      ? { mode: 'full', ...(view.branch ? { branch: view.branch } : {}) }
      : { mode: 'focus', ...(focusId ? { focus: focusId } : {}), depth: view.depth };
  const graph = useTreeGraph(
    treeId,
    query,
    { focusId: view.mode === 'focus' ? focusId : null, meId: detail.me.personId },
    refreshKey,
  );

  useEffect(() => {
    let active = true;
    void api.listDisconnected(treeId).then((r) => {
      if (active && r.ok) setDisconnected(r.data);
    });
    return () => {
      active = false;
    };
  }, [api, treeId, refreshKey]);

  const changed = useCallback(() => {
    setRefreshKey((k) => k + 1);
    onPersonsChanged();
  }, [onPersonsChanged]);
  // `go` reads the current URL through a ref, so `actions` never changes with the URL and a
  // navigation doesn't re-render every card.
  const latest = useRef({ navigate, params, keepFocus: null as string | null });
  const keepFocus = view.mode === 'focus' ? focusId : null;
  useEffect(() => {
    latest.current = { navigate, params, keepFocus };
  });
  const base = `/trees/${treeId}`;
  const go = useCallback((path: string, change: CanvasChange) => {
    const { navigate: nav, params: current } = latest.current;
    void nav(`${path}${canvasSearch(current, change)}`);
  }, []);
  const actions = useMemo(
    () => ({
      openPerson: (id: string) => go(`${base}/people/${id}`, { focus: null, tab: null, add: null }),
      addRelative: (id: string, as: RelativeRole) =>
        go(`${base}/people/${id}`, { focus: null, tab: 'relations', add: as }),
      openUnion: (id: string) =>
        go(`${base}/unions/${id}`, { focus: latest.current.keepFocus, tab: null, add: null }),
    }),
    [go, base],
  );
  const [notice, setNotice] = useState<string | null>(null);
  const onReorder = useCallback(
    async (unionId: string, childIds: string[]) => {
      const res = await api.reorderChildren(treeId, unionId, childIds);
      setNotice(res.ok ? null : res.error.message);
      changed();
    },
    [api, treeId, changed],
  );
  const returnFocusTo = useRef<{ id: string | null } | null>(null);
  const close = useCallback(() => {
    returnFocusTo.current = { id: personId ?? null };
    go(base, { focus: latest.current.keepFocus, tab: null, add: null });
  }, [go, base, personId]);
  const canAdd = detail.capabilities.editAnywhere || detail.me.steward.active;
  const selected = (newPerson && canAdd) || personId !== undefined || unionId !== undefined;
  const ready = graph.status === 'ready' ? graph : null;
  const panel = useRef<HTMLElement>(null);
  const canvasArea = useRef<HTMLElement>(null);
  const panelKey = `${newPerson}/${personId}/${unionId}`;

  // Opening the panel moves focus to its heading, once the panel has rendered one.
  useEffect(() => {
    const el = panel.current;
    if (!selected || !el) return;
    const focusHeading = () => {
      const h = el.querySelector('h2');
      if (!h) return false;
      h.tabIndex = -1;
      h.focus();
      return true;
    };
    if (focusHeading()) return;
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selected, panelKey]);

  // Closing returns focus to the card that was open, or to the canvas if it isn't rendered.
  useEffect(() => {
    const pending = returnFocusTo.current;
    if (selected || !pending) return;
    returnFocusTo.current = null;
    const card = pending.id
      ? canvasArea.current?.querySelector<HTMLElement>(
          `[data-person-id="${CSS.escape(pending.id)}"]`,
        )
      : null;
    (card ?? canvasArea.current)?.focus();
  }, [selected]);

  // Escape closes the panel (but not while it is cancelling a field inside a form control).
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('input, select, textarea')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, close]);

  return (
    <>
      <CanvasToolbar
        treeId={treeId}
        detail={detail}
        persons={persons}
        params={view}
        disconnected={disconnected}
        hrefOf={hrefOf}
        onChange={(change) => go(pathname, change)}
      />
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <PhotoRefreshContext.Provider value={refreshPhotos}>
        <div className={selected ? 'tree-workspace has-panel' : 'tree-workspace'}>
          <section
            className="canvas-area"
            aria-label="Family tree view"
            tabIndex={-1}
            ref={canvasArea}
          >
            {graph.status === 'loading' && <p role="status">Drawing the tree…</p>}
            {graph.status === 'error' && (
              <>
                <FormError>{graph.message}</FormError>
                <p>
                  <Link to={base}>Back to the starting person</Link>
                </p>
              </>
            )}
            {ready?.graph.needsBranch && (
              <p role="status">
                This tree has {ready.graph.total.toLocaleString('en')} people, too many to draw at
                once. Choose a branch to show.
              </p>
            )}
            {ready?.graph.truncated && (
              <p role="status" className="notice">
                Only part of the tree is shown. Pick a branch or use the focus view to see the rest.
              </p>
            )}
            {ready && !ready.graph.needsBranch && ready.nodes.length === 0 && (
              <p>No one to show yet.</p>
            )}
            {ready && ready.nodes.length > 0 && (
              <FamilyCanvas
                nodes={ready.nodes}
                edges={ready.edges}
                families={ready.families}
                focusId={view.mode === 'focus' ? focusId : null}
                actions={actions}
                selectedId={personId ?? null}
                onReorder={(u, ids) => void onReorder(u, ids)}
              />
            )}
          </section>
          {selected ? (
            <aside className="tree-panel" aria-label="Details" ref={panel}>
              <p className="panel-close">
                <button type="button" className="secondary" onClick={close}>
                  Close
                </button>
              </p>
              {newPerson && canAdd ? (
                <AddPersonForm
                  treeId={treeId}
                  persons={persons}
                  detail={detail}
                  onCreated={changed}
                />
              ) : personId ? (
                <PersonPanel
                  key={personId}
                  treeId={treeId}
                  personId={personId}
                  persons={persons}
                  onChanged={changed}
                />
              ) : (
                <UnionPanel
                  key={unionId}
                  treeId={treeId}
                  union={ready?.graph.unions.find((u) => u.id === unionId)}
                  loading={graph.status === 'loading'}
                  persons={persons}
                  onChanged={changed}
                />
              )}
            </aside>
          ) : (
            <p className="hint canvas-hint">Select someone on the tree to see their details.</p>
          )}
        </div>
      </PhotoRefreshContext.Provider>
      {/* Opened when the layout timed out, so people stay reachable (decision 4). */}
      <details
        id="people-fallback"
        className="people-fallback"
        open={graph.status === 'error' && graph.timedOut ? true : undefined}
      >
        <summary>All people ({persons.length})</summary>
        <PeopleList treeId={treeId} persons={persons} detail={detail} selectedId={personId} />
      </details>
    </>
  );
}
