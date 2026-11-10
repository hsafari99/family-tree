import { GRAPH_DEPTH_MAX, type PersonSummary, type TreeDetail } from '@family-tree/shared';
import { Link, useSearchParams } from 'react-router';
import { PersonPicker } from '../components/PersonPicker';
import { DisconnectedPeople } from './DisconnectedPeople';
import { type CanvasChange, type CanvasParams, canvasSearch } from './params';
import { SearchBox } from './SearchBox';

export function CanvasToolbar({
  treeId,
  detail,
  persons,
  params,
  disconnected,
  hrefOf,
  selectedId,
  onChange,
}: {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  params: CanvasParams;
  disconnected: PersonSummary[];
  hrefOf: (personId: string) => string;
  selectedId?: string | null;
  onChange: (change: CanvasChange) => void;
}) {
  const [search] = useSearchParams();
  const { me, capabilities } = detail;
  const full = params.mode === 'full';
  return (
    <div className="canvas-toolbar">
      <SearchBox treeId={treeId} persons={persons} meId={detail.me.personId} />
      <Link
        to={`/trees/${treeId}/relationship${canvasSearch(search, { tab: null, add: null, to: selectedId ?? null })}`}
      >
        How are we related?
      </Link>
      <div role="group" aria-label="View">
        <button
          type="button"
          className="secondary"
          aria-pressed={!full}
          onClick={() => onChange({ view: null, branch: null })}
        >
          Focus
        </button>
        <button
          type="button"
          className="secondary"
          aria-pressed={full}
          onClick={() => onChange({ view: 'full', focus: null })}
        >
          Full
        </button>
      </div>
      {!full && (
        <>
          <label>
            Generations{' '}
            <input
              type="range"
              min="1"
              max={GRAPH_DEPTH_MAX}
              step="1"
              value={params.depth}
              aria-valuetext={`${params.depth} ${params.depth === 1 ? 'step' : 'steps'}`}
              onChange={(e) => onChange({ depth: Number(e.target.value) })}
            />
          </label>
          <output>{params.depth}</output>
        </>
      )}
      {full && (
        <PersonPicker
          label="Show the branch of"
          clearLabel="Whole tree"
          persons={persons}
          value={params.branch}
          onChange={(id) => onChange({ branch: id })}
        />
      )}
      {(capabilities.editAnywhere || me.steward.active) && (
        <Link to={`/trees/${treeId}/people/new${search.size ? `?${search}` : ''}`}>
          Add a person
        </Link>
      )}
      <DisconnectedPeople persons={disconnected} hrefOf={hrefOf} />
      <Link to={`/trees/${treeId}/members`}>Members and invites</Link>
      {capabilities.manageTree && <Link to={`/trees/${treeId}/trash`}>Trash</Link>}
      <Link to="/">Your trees</Link>
      <a
        href="#people-fallback"
        onClick={() => {
          const d = document.getElementById('people-fallback');
          if (d instanceof HTMLDetailsElement) d.open = true;
        }}
      >
        List of all people
      </a>
    </div>
  );
}
