import { GRAPH_DEPTH_MAX, type PersonSummary, type TreeDetail } from '@family-tree/shared';
import type { ReactNode, Ref } from 'react';
import { XIcon } from '../components/SectionDialog';
import { Link, useLocation, useSearchParams } from 'react-router';
import { DisconnectedPeople } from './DisconnectedPeople';
import { RowContent } from './PanelRow';
import { type CanvasChange, type CanvasParams, canvasSearch } from './params';

/**
 * Focus | Full above the canvas: real links that set `view`, so a view can be shared. The current
 * one is marked with aria-current (aria-pressed is for buttons).
 */
export function ViewLinks({ params }: { params: CanvasParams }) {
  const [search] = useSearchParams();
  const { pathname } = useLocation();
  const full = params.mode === 'full';
  const links = [
    {
      label: 'Focus',
      current: !full,
      to: canvasSearch(search, { view: null, branch: null }),
      icon: <FocusIcon />,
    },
    {
      label: 'Full',
      current: full,
      to: canvasSearch(search, { view: 'full', focus: null }),
      icon: <FullIcon />,
    },
  ];
  return (
    <div role="group" aria-label="View" className="view-links">
      {links.map((l) => (
        <Link
          key={l.label}
          to={`${pathname}${l.to}`}
          className="view-link"
          aria-current={l.current ? 'true' : undefined}
        >
          {l.icon}
          {l.label}
        </Link>
      ))}
    </div>
  );
}

/** The focus view's Generations slider (the full view has none). */
export function DepthControl({
  params,
  onChange,
}: {
  params: CanvasParams;
  onChange: (change: CanvasChange) => void;
}) {
  if (params.mode === 'full') return null;
  return (
    <div className="depth-control">
      <label htmlFor="tree-depth">Generations</label>
      <input
        id="tree-depth"
        type="range"
        min="1"
        max={GRAPH_DEPTH_MAX}
        step="1"
        value={params.depth}
        aria-valuetext={`${params.depth} ${params.depth === 1 ? 'step' : 'steps'}`}
        onChange={(e) => onChange({ depth: Number(e.target.value) })}
      />
      <output htmlFor="tree-depth">{params.depth}</output>
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
              icon={<PlusIcon />}
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
          />
        </li>
        {capabilities.manageTree && (
          <li>
            <RowLink to={`/trees/${treeId}/trash`} title="Trash" icon={<ArrowIcon />} />
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
            <RowContent title="List of all people" icon={<ArrowIcon direction="down" />} />
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
              <RowContent title="Tree settings" />
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function RowLink({ to, title, icon }: { to: string; title: string; icon: ReactNode }) {
  return (
    <Link to={to} className="section-row">
      <RowContent title={title} icon={icon} />
    </Link>
  );
}

/** "Goes to another page" (or, pointing down, further down this one). */
function ArrowIcon({ direction = 'right' }: { direction?: 'right' | 'down' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      style={direction === 'down' ? { transform: 'rotate(90deg)' } : undefined}
    >
      <path
        d="M2.5 8h10M8.5 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** A centre dot in rings: the view around one person. */
function FocusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

/** A small family tree: the whole tree, or one person's branch. */
export function FullIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="6" y="1.5" width="4" height="3.5" rx="0.8" />
        <rect x="1.5" y="11" width="4" height="3.5" rx="0.8" />
        <rect x="10.5" y="11" width="4" height="3.5" rx="0.8" />
        <path d="M8 5v3M3.5 11V8h9v3" />
      </g>
    </svg>
  );
}
