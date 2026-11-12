import {
  GRAPH_DEPTH_MAX,
  GRAPH_GENERATIONS_MAX,
  type PersonSummary,
  type TreeDetail,
} from '@family-tree/shared';
import type { ReactNode, Ref } from 'react';
import {
  ArrowIcon,
  FanIcon,
  FocusIcon,
  FullIcon,
  ListIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
  TreeIcon,
  UsersIcon,
  XIcon,
} from '../components/icons';
import { Link, useLocation, useSearchParams } from 'react-router';
import { DisconnectedPeople } from './DisconnectedPeople';
import { RowContent } from './PanelRow';
import { type CanvasChange, type CanvasParams, canvasSearch } from './params';

/**
 * Focus | Full | Fan | Tree above the canvas: real links that set `view`, so a view can be shared.
 * The current one is marked with aria-current (aria-pressed is for buttons).
 */
export function ViewLinks({ params }: { params: CanvasParams }) {
  const [search] = useSearchParams();
  const { pathname } = useLocation();
  const links = [
    { view: 'focus', label: 'Focus', change: { view: null, branch: null }, icon: <FocusIcon /> },
    { view: 'full', label: 'Full', change: { view: 'full', focus: null }, icon: <FullIcon /> },
    { view: 'fan', label: 'Fan', change: { view: 'fan', branch: null }, icon: <FanIcon /> },
    { view: 'tree', label: 'Tree', change: { view: 'tree', branch: null }, icon: <TreeIcon /> },
  ] as const;
  return (
    <div role="group" aria-label="View" className="view-links">
      {links.map((l) => (
        <Link
          key={l.label}
          to={`${pathname}${canvasSearch(search, l.change)}`}
          className="view-link"
          aria-current={params.view === l.view ? 'true' : undefined}
        >
          {l.icon}
          {l.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * The Generations slider: the focus view's hourglass (N up and N down, 1 to 3), or the fan's and
 * the tree's generations (1 to 6). The full view has none.
 */
export function DepthControl({
  params,
  onChange,
}: {
  params: CanvasParams;
  onChange: (change: CanvasChange) => void;
}) {
  if (params.view === 'full') return null;
  const focus = params.view === 'focus';
  const value = focus ? params.depth : params.gens;
  const plural = value === 1 ? 'generation' : 'generations';
  const what = focus ? 'up and down' : params.view === 'fan' ? 'of ancestors' : 'of descendants';
  const hint = focus
    ? 'Generations up and down from the focus person'
    : params.view === 'fan'
      ? 'Generations of ancestors in the fan'
      : 'Generations of descendants in the tree';
  return (
    <div className="depth-control">
      <label htmlFor="tree-depth">Generations</label>
      <input
        id="tree-depth"
        type="range"
        min="1"
        max={focus ? GRAPH_DEPTH_MAX : GRAPH_GENERATIONS_MAX}
        step="1"
        value={value}
        aria-valuetext={`${value} ${plural} ${what}`}
        aria-describedby="tree-depth-hint"
        onChange={(e) =>
          onChange(focus ? { depth: Number(e.target.value) } : { gens: Number(e.target.value) })
        }
      />
      <output htmlFor="tree-depth">{value}</output>
      <p id="tree-depth-hint" className="depth-hint">
        {hint}
      </p>
    </div>
  );
}

/**
 * Whose branch the full view draws, with an × back to the whole tree. The live region is always
 * there (empty, it takes no room), so a screen reader hears the change.
 */
export function BranchStatus({
  name,
  onClear,
}: {
  /** The branch's person, or null when the whole tree (or the focus view) is shown. */
  name: string | null;
  onClear: () => void;
}) {
  return (
    <div className={name ? 'branch-status is-active' : 'branch-status'}>
      <p aria-live="polite">{name ? `Showing ${name}’s branch` : ''}</p>
      {name && (
        <button
          type="button"
          className="icon-button"
          aria-label="Show whole tree"
          title="Show whole tree"
          onClick={onClear}
        >
          <XIcon />
        </button>
      )}
    </div>
  );
}

/**
 * The tree-wide rows at the bottom of the side panel, in the same one-line row design as a
 * person's sections, with a trailing arrow for another page and a chevron for a popup or a list
 * that opens here. Gated by what the member may do.
 */
export function TreeLinks({
  treeId,
  detail,
  disconnected,
  hrefOf,
  onSettings,
  settingsRef,
}: {
  treeId: string;
  detail: TreeDetail;
  disconnected: PersonSummary[];
  hrefOf: (personId: string) => string;
  /** Opens Tree settings in a dialog; left out for members who can't manage the tree. */
  onSettings?: () => void;
  settingsRef?: Ref<HTMLButtonElement>;
}) {
  const [search] = useSearchParams();
  const { me, capabilities } = detail;
  return (
    <section className="tree-links" aria-labelledby="tree-links-title">
      <h2 id="tree-links-title" className="panel-group-title">
        This tree
      </h2>
      <ul className="section-list">
        {(capabilities.editAnywhere || me.steward.active) && (
          <li>
            <RowLink
              to={`/trees/${treeId}/people/new${search.size ? `?${search}` : ''}`}
              title="Add a person"
              icon={<ArrowIcon />}
              lead={<PlusIcon />}
            />
          </li>
        )}
        {disconnected.length > 0 && (
          <li>
            <DisconnectedPeople persons={disconnected} hrefOf={hrefOf} />
          </li>
        )}
        <li>
          <RowLink
            to={`/trees/${treeId}/members`}
            title="Members and invites"
            icon={<ArrowIcon />}
            lead={<UsersIcon />}
          />
        </li>
        {capabilities.manageTree && (
          <li>
            <RowLink
              to={`/trees/${treeId}/trash`}
              title="Trash"
              icon={<ArrowIcon />}
              lead={<TrashIcon />}
            />
          </li>
        )}
        <li>
          <a
            href="#people-fallback"
            className="section-row"
            onClick={() => {
              const d = document.getElementById('people-fallback');
              if (d instanceof HTMLDetailsElement) d.open = true;
            }}
          >
            <RowContent
              title="List of all people"
              icon={<ArrowIcon direction="down" />}
              lead={<ListIcon />}
            />
          </a>
        </li>
        {onSettings && (
          <li>
            <button
              type="button"
              className="section-row"
              aria-haspopup="dialog"
              ref={settingsRef}
              onClick={onSettings}
            >
              <RowContent title="Tree settings" lead={<SettingsIcon />} />
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function RowLink({
  to,
  title,
  icon,
  lead,
}: {
  to: string;
  title: string;
  icon: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <Link to={to} className="section-row">
      <RowContent title={title} icon={icon} lead={lead} />
    </Link>
  );
}
