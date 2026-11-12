import {
  closeRelativeSteps,
  GRAPH_DEPTH_MAX,
  type GraphQuery,
  type KinStep,
  type PersonSummary,
  type RelativeRole,
  type TreeDetail,
} from '@family-tree/shared';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useMatch, useNavigate, useParams, useSearchParams } from 'react-router';
import { FormError } from '../../components/forms';
import { PersonPhoto, PhotoRefreshContext, useThrottled } from '../../components/PersonPhoto';
import { ChevronIcon, SectionDialog, XIcon } from '../../components/SectionDialog';
import { RowContent } from '../../canvas/PanelRow';
import { SearchBox } from '../../canvas/SearchBox';
import { DepthControl, TreeLinks, ViewLinks } from '../../canvas/TreeControls';
import type { CoupleChange } from '../../canvas/couples';
import { FamilyCanvas } from '../../canvas/FamilyCanvas';
import {
  type CanvasChange,
  canvasSearch,
  readCanvasParams,
  usePersonHref,
} from '../../canvas/params';
import { applyHighlight, type PathHighlight, pathHighlight } from '../../canvas/highlight';
import { useTreeGraph } from '../../canvas/useTreeGraph';
import { ROLE_LABEL } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { AddPersonForm } from './AddPersonForm';
import { readCollapsed, writeCollapsed } from './panel-state';
import { PeopleList } from './PeopleList';
import { PersonPanel } from './PersonPanel';
import { RelationshipPanel } from './RelationshipPanel';
import { UnionPanel } from './UnionPanel';

export function TreeWorkspace({
  treeId,
  detail,
  persons,
  onPersonsChanged,
  settings = null,
}: {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  onPersonsChanged: () => void;
  /** Tree settings, for members who may manage the tree: a dialog at `?tab=settings`. */
  settings?: ReactNode;
}) {
  const { personId, unionId } = useParams();
  const newPerson = useMatch('/trees/:treeId/people/new') !== null;
  const [params, setParams] = useSearchParams();
  // "How are we related?" opens in a dialog over the page (`?tab=related`).
  const relatedOpen = params.get('tab') === 'related';
  const settingsOpen = settings !== null && params.get('tab') === 'settings';
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
  const canAdd = detail.capabilities.editAnywhere || detail.me.steward.active;
  const selected = (newPerson && canAdd) || personId !== undefined || unionId !== undefined;
  // The side panel (search, depth, the selection, tree links) can be collapsed to a rail; the
  // choice is remembered (brief #15). On a phone it starts as a handle when nothing is selected,
  // so the sheet doesn't cover the tree on arrival.
  const [collapsed, setCollapsedState] = useState(
    () => readCollapsed() || (!selected && isPhone()),
  );
  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    writeCollapsed(v);
  }, []);
  // Opening something from the canvas always shows it.
  const actions = useMemo(
    () => ({
      openPerson: (id: string) => {
        setCollapsed(false);
        go(`${base}/people/${id}`, { focus: null, tab: null, add: null, ...NO_PAIR });
      },
      addRelative: (id: string, as: RelativeRole) => {
        setCollapsed(false);
        go(`${base}/people/${id}`, { focus: null, tab: 'relations', add: as, ...NO_PAIR });
      },
      openUnion: (id: string) => {
        setCollapsed(false);
        go(`${base}/unions/${id}`, {
          focus: latest.current.keepFocus,
          tab: null,
          add: null,
          ...NO_PAIR,
        });
      },
    }),
    [go, base, setCollapsed],
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
  const onReparent = useCallback(
    async (linkId: string, unionId: string) => {
      const res = await api.reparentLink(treeId, linkId, unionId);
      setNotice(res.ok ? 'Parents changed.' : res.error.message);
      changed();
    },
    [api, treeId, changed],
  );
  const onCoupleChange = useCallback(
    async (change: CoupleChange) => {
      const res =
        change.kind === 'swap'
          ? await api.swapPartners(treeId, change.unionId)
          : await api.reorderUnions(treeId, change.personId, change.unionIds);
      setNotice(res.ok ? null : res.error.message);
      changed();
    },
    [api, treeId, changed],
  );
  const returnFocusTo = useRef<{ id: string | null } | null>(null);
  // Close (and Escape) collapse the panel; the URL keeps the selection, so the card stays marked.
  const close = useCallback(() => {
    returnFocusTo.current = { id: personId ?? null };
    setCollapsed(true);
  }, [personId, setCollapsed]);
  const shown = !collapsed;
  // Expanding with nothing selected puts focus in the search box (there is no heading to go to).
  const focusSearch = useRef(false);
  const expand = useCallback(() => {
    focusSearch.current = true;
    setCollapsed(false);
  }, [setCollapsed]);
  // The rail shows whose panel it brings back.
  const railPerson = personId ? (persons.find((p) => p.id === personId) ?? null) : null;
  // The member's own card says their role; the tree's root says so too (both after the name).
  const tagsOf = (id: string) => [
    ...(id === detail.me.personId
      ? [ROLE_LABEL[detail.me.role], ...(detail.me.steward.active ? ['Steward'] : [])]
      : []),
    ...(id === detail.tree.rootPersonId ? ['Starting person'] : []),
  ];
  const ready = graph.status === 'ready' ? graph : null;
  const [highlight, setHighlight] = useState<PathHighlight | null>(null);
  // The drawn path belongs to one From/To pair: another pair, or leaving the panel, clears it.
  const fromParam = params.get('from');
  const toParam = params.get('to');
  useEffect(() => {
    setHighlight(null);
  }, [fromParam, toParam]);
  // "Show on the tree" closes the dialog, so the path can be seen; From and To stay in the URL, and
  // so does the path, until the pair changes or the dialog is closed with its X.
  const showPath = useCallback(
    (fromId: string, steps: KinStep[]) => {
      setHighlight(pathHighlight(fromId, steps));
      const n = closeRelativeSteps(steps);
      go(
        pathname,
        n <= GRAPH_DEPTH_MAX
          ? { view: null, branch: null, focus: fromId, depth: Math.max(1, n), tab: null }
          : { view: 'full', focus: null, tab: null },
      );
    },
    [go, pathname],
  );
  const relatedRow = useRef<HTMLButtonElement>(null);
  const setRelated = useCallback(
    (open: boolean) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete('add');
          if (open) {
            next.set('tab', 'related');
            if (personId) next.set('to', personId);
          } else {
            next.delete('tab');
            next.delete('from');
            next.delete('to');
          }
          return next;
        },
        { replace: true },
      ),
    [setParams, personId],
  );
  const settingsRow = useRef<HTMLButtonElement>(null);
  const setSettings = useCallback(
    (open: boolean) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete('add');
          if (open) next.set('tab', 'settings');
          else next.delete('tab');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  // However a dialog closes, focus goes back to its row (unless something else has it).
  useReturnFocus(relatedOpen, relatedRow);
  useReturnFocus(settingsOpen, settingsRow);
  const drawn = useMemo(
    () =>
      ready && highlight
        ? { ...ready, ...applyHighlight(ready.nodes, ready.edges, highlight) }
        : ready,
    [ready, highlight],
  );
  const offView =
    highlight !== null &&
    ready !== null &&
    [...highlight.personIds].some((id) => !ready.graph.persons.some((p) => p.id === id));
  const panel = useRef<HTMLElement>(null);
  const selection = useRef<HTMLDivElement>(null);
  const canvasArea = useRef<HTMLElement>(null);
  const panelKey = `${newPerson}/${personId}/${unionId}`;
  // Anything newly opened (a toolbar link, search, the people list) expands the panel. Not on the
  // first render, so a remembered collapse survives a reload (a ref of the last key, not a
  // first-run flag, so StrictMode's double effects don't count as a change).
  const lastKey = useRef(panelKey);
  useEffect(() => {
    if (lastKey.current === panelKey) return;
    lastKey.current = panelKey;
    setCollapsed(false);
  }, [panelKey, setCollapsed]);

  // Opening the panel on someone moves focus to their heading, once it has rendered one; expanding
  // it with nothing selected focuses the search box. (Not on a first visit with nothing selected:
  // the page's own Tab order starts at the header.)
  useEffect(() => {
    const el = selection.current;
    if (!shown || !el) return;
    if (!selected) {
      if (focusSearch.current) panel.current?.querySelector<HTMLElement>('input')?.focus();
      focusSearch.current = false;
      return;
    }
    focusSearch.current = false;
    const focusHeading = () => {
      // A section dialog opened by a deep link (?tab=) keeps the focus it took.
      if (document.querySelector('dialog[open]')) return true;
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
  }, [shown, selected, panelKey]);

  // Closing returns focus to the card that was open, or to the canvas if it isn't rendered. (The
  // rail's Expand button sits just before the canvas, one Shift+Tab away.)
  useEffect(() => {
    const pending = returnFocusTo.current;
    if (shown || !pending) return;
    returnFocusTo.current = null;
    const card = pending.id
      ? canvasArea.current?.querySelector<HTMLElement>(
          `[data-person-id="${CSS.escape(pending.id)}"]`,
        )
      : null;
    (card ?? canvasArea.current)?.focus();
  }, [shown]);

  // Escape collapses the panel while someone is selected (but not while it is cancelling a field
  // inside a form control, or closing a menu or a dialog, which handle their own Escape).
  useEffect(() => {
    if (!shown || !selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('input, select, textarea, dialog')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown, selected, close]);

  return (
    <>
      <PhotoRefreshContext.Provider value={refreshPhotos}>
        <div className={shown ? 'tree-workspace has-panel' : 'tree-workspace has-rail'}>
          {/* Kept mounted while collapsed, so a half-filled form survives hiding the panel. */}
          <aside
            id="tree-panel"
            className="tree-panel"
            aria-label="Details"
            ref={panel}
            hidden={!shown}
          >
            <div className="panel-top">
              <SearchBox treeId={treeId} persons={persons} meId={detail.me.personId} />
              <button
                type="button"
                className="icon-button"
                aria-label="Collapse panel"
                title="Collapse panel"
                aria-expanded="true"
                aria-controls="tree-panel"
                onClick={close}
              >
                <XIcon />
              </button>
            </div>
            <DepthControl persons={persons} params={view} onChange={(c) => go(pathname, c)} />
            <div className="panel-selection" ref={selection}>
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
                  tags={tagsOf(personId)}
                />
              ) : unionId ? (
                <UnionPanel
                  key={unionId}
                  treeId={treeId}
                  union={ready?.graph.unions.find((u) => u.id === unionId)}
                  loading={graph.status === 'loading'}
                  persons={persons}
                  onChanged={changed}
                />
              ) : (
                <p className="hint panel-hint">Select someone on the tree.</p>
              )}
            </div>
            <ul className="section-list related-list">
              <li>
                <button
                  type="button"
                  className="section-row"
                  aria-haspopup="dialog"
                  ref={relatedRow}
                  onClick={() => setRelated(true)}
                >
                  <RowContent title="How are we related?" />
                </button>
              </li>
            </ul>
            <TreeLinks
              treeId={treeId}
              detail={detail}
              disconnected={disconnected}
              hrefOf={hrefOf}
              {...(settings
                ? { onSettings: () => setSettings(true), settingsRef: settingsRow }
                : {})}
            />
          </aside>
          {/* Collapsed, the panel leaves a slim rail (a bottom handle on a phone) to bring it back. */}
          {!shown && (
            <div className="panel-rail">
              <button
                type="button"
                className="rail-expand"
                title="Expand panel"
                aria-expanded="false"
                aria-controls="tree-panel"
                onClick={expand}
              >
                <ChevronIcon />
                {railPerson && (
                  <PersonPhoto url={null} person={railPerson} className="rail-avatar" />
                )}
                {/* One label per layout: hidden text drops out of the accessible name. */}
                <span className="rail-text">Expand panel</span>
                <span className="rail-text-phone">Show details</span>
              </button>
            </div>
          )}
          <div className="canvas-column">
            <ViewLinks params={view} />
            {notice && (
              <p role="status" className="notice">
                {notice}
              </p>
            )}
            <section
              className="canvas-area"
              aria-label="Family tree view"
              tabIndex={-1}
              ref={canvasArea}
            >
              {!selected && (
                <p className="hint canvas-hint">
                  <span>Select someone on the tree to see their details.</span>{' '}
                  <span>
                    You can reorder siblings, swap a couple’s sides, and order someone’s partners.
                    Everything else is placed automatically.
                  </span>{' '}
                  <span>
                    With a mouse, drag the cards, or drag the dot end of a child’s line onto other
                    parents to move them; the Relations tab does the same from the keyboard.
                  </span>
                </p>
              )}
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
                  Only part of the tree is shown. Pick a branch or use the focus view to see the
                  rest.
                </p>
              )}
              {ready && !ready.graph.needsBranch && ready.nodes.length === 0 && (
                <p>No one to show yet.</p>
              )}
              {offView && (
                <p role="status" className="notice">
                  Part of the path is outside this view. Try the full view.
                </p>
              )}
              {drawn && drawn.nodes.length > 0 && (
                <FamilyCanvas
                  nodes={drawn.nodes}
                  edges={drawn.edges}
                  families={drawn.families}
                  focusId={view.mode === 'focus' ? focusId : null}
                  actions={actions}
                  selectedId={personId ?? null}
                  onReorder={(u, ids) => void onReorder(u, ids)}
                  onReparent={(l, u) => void onReparent(l, u)}
                  couples={drawn.couples}
                  onCoupleChange={(c) => void onCoupleChange(c)}
                />
              )}
            </section>
          </div>
        </div>
      </PhotoRefreshContext.Provider>
      {relatedOpen && (
        <SectionDialog title="How are we related?" onClose={() => setRelated(false)}>
          <RelationshipPanel treeId={treeId} detail={detail} persons={persons} onShow={showPath} />
        </SectionDialog>
      )}
      {settingsOpen && (
        <SectionDialog title="Tree settings" onClose={() => setSettings(false)}>
          {settings}
        </SectionDialog>
      )}
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

/** The `from`/`to` pair of "How are we related?", dropped when someone else is opened. */
const NO_PAIR = { from: null, to: null } as const;

/** When the dialog `open` tracks closes, focus goes back to `row` if it went nowhere else. */
function useReturnFocus(open: boolean, row: RefObject<HTMLElement | null>) {
  const was = useRef(open);
  useEffect(() => {
    const prev = was.current;
    was.current = open;
    if (!prev || open) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) row.current?.focus();
  }, [open, row]);
}

function isPhone(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches;
}
