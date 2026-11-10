import { normalizeName, type PersonSummary, type TreeDetail } from '@family-tree/shared';
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { personName, personYears } from '../trees/format';
import { DisconnectedPeople } from './DisconnectedPeople';
import type { CanvasChange, CanvasParams } from './params';

const MATCHES_MAX = 20;

/** A searchable branch chooser: a select with thousands of options would be unusable. */
function BranchPicker({
  persons,
  branch,
  onChange,
}: {
  persons: PersonSummary[];
  branch: string | null;
  onChange: (change: CanvasChange) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const query = normalizeName(text);
  const matches =
    query.length < 2
      ? []
      : persons.filter((p) => normalizeName(personName(p)).includes(query)).slice(0, MATCHES_MAX);
  const chosen = branch ? persons.find((p) => p.id === branch) : undefined;
  return (
    <div className="branch-picker">
      <label htmlFor={id}>Show the branch of</label>{' '}
      <input
        id={id}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setText('');
        }}
      />
      {matches.length > 0 && (
        <ul className="branch-matches">
          {matches.map((p) => {
            const years = personYears(p);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setText('');
                    onChange({ branch: p.id });
                  }}
                >
                  {personName(p)}
                  {years && ` ${years}`}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {branch && (
        <p className="branch-current">
          Branch: {chosen ? personName(chosen) : 'someone'}{' '}
          <button type="button" className="secondary" onClick={() => onChange({ branch: null })}>
            Whole tree
          </button>
        </p>
      )}
    </div>
  );
}

export function CanvasToolbar({
  treeId,
  detail,
  persons,
  params,
  disconnected,
  hrefOf,
  onChange,
}: {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  params: CanvasParams;
  disconnected: PersonSummary[];
  hrefOf: (personId: string) => string;
  onChange: (change: CanvasChange) => void;
}) {
  const [search] = useSearchParams();
  const { me, capabilities } = detail;
  const full = params.mode === 'full';
  return (
    <div className="canvas-toolbar">
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
              max="3"
              step="1"
              value={params.depth}
              aria-valuetext={`${params.depth} ${params.depth === 1 ? 'step' : 'steps'}`}
              onChange={(e) => onChange({ depth: Number(e.target.value) })}
            />
          </label>
          <output>{params.depth}</output>
        </>
      )}
      {full && <BranchPicker persons={persons} branch={params.branch} onChange={onChange} />}
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
