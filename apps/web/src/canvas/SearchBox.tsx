import {
  kinshipChain,
  kinshipTerm,
  type PersonSummary,
  type SearchQuery,
  type SearchResult,
  searchQuerySchema,
} from '@family-tree/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FormError } from '../components/forms';
import { PersonPhoto } from '../components/PersonPhoto';
import { PersonPicker } from '../components/PersonPicker';
import { personName, personYears } from '../trees/format';
import { useTreesApi } from '../trees/TreesApiContext';
import { usePersonHref } from './params';

interface Filters {
  bornFrom: string;
  bornTo: string;
  diedFrom: string;
  diedTo: string;
  place: string;
  status: '' | 'living' | 'deceased';
  branch: string;
}
const NO_FILTERS: Filters = {
  bornFrom: '',
  bornTo: '',
  diedFrom: '',
  diedTo: '',
  place: '',
  status: '',
  branch: '',
};
// Any valid UUID: the schema only checks that a branch is present, the server checks the real id.
const SOME_UUID = '00000000-0000-4000-8000-000000000000';

/** "Your second cousin", "You", "Not connected to you"; '' when the user has no card. */
export function relationLabel(r: SearchResult, meId: string | null): string {
  if (meId === null) return '';
  if (r.relation === null) return 'Not connected to you';
  if (r.relation.length === 0) return 'You';
  const term = kinshipTerm(r.relation);
  const words = term ? `your ${term}` : kinshipChain(r.relation, 'your');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Spec §6 search box (decision 23). */
export function SearchBox({
  treeId,
  persons,
  meId,
}: {
  treeId: string;
  persons: PersonSummary[];
  meId: string | null;
}) {
  const api = useTreesApi();
  const navigate = useNavigate();
  const hrefOf = usePersonHref(treeId);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);

  const years = [filters.bornFrom, filters.bornTo, filters.diedFrom, filters.diedTo];
  const badYear = years.some((y) => y.trim() !== '' && !/^\d{1,4}$/.test(y.trim()));
  const parsed = badYear
    ? null
    : searchQuerySchema.safeParse({ q, ...filters, branch: filters.branch ? SOME_UUID : '' });
  // Fixed messages only: never Zod's own coercion text.
  const rangeError = badYear
    ? 'Enter years as numbers, for example 1950'
    : parsed &&
        !parsed.success &&
        parsed.error.issues.some((i) => i.path[0] === 'bornTo' || i.path[0] === 'diedTo')
      ? 'From must not be after to'
      : null;
  const key = parsed?.success
    ? JSON.stringify({ ...parsed.data, ...(filters.branch ? { branch: filters.branch } : {}) })
    : '';
  const countText = !results
    ? ''
    : results.length === 0
      ? 'No one found'
      : results.length === 1
        ? '1 person found'
        : `${results.length} people found`;
  const active = Object.values(filters).filter((v) => v !== '').length;

  useEffect(() => {
    const id = ++seq.current;
    if (!key) {
      setResults(null);
      setError(null);
      return;
    }
    // A newer query (or unmount) aborts the request in flight, not just ignores it.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const res = await api.search(treeId, JSON.parse(key) as SearchQuery, controller.signal);
      if (id !== seq.current || controller.signal.aborted) return; // a newer search started
      if (res.ok) {
        setResults(res.data);
        setError(null);
      } else {
        setResults(null);
        setError(res.error.message);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, treeId, key]);

  const set = (k: keyof Filters) => (e: { target: { value: string } }) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  const close = () => {
    setQ('');
    setResults(null);
    setError(null);
  };

  return (
    <div
      className="search-box"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // Handled here: the workspace's Escape listener must not also close the side panel.
        e.preventDefault();
        close();
        searchInput.current?.focus();
      }}
    >
      <form role="search" aria-label="Search people" onSubmit={(e) => e.preventDefault()}>
        <label>
          Search{' '}
          <input
            ref={searchInput}
            type="search"
            value={q}
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>{' '}
        <button
          type="button"
          className="secondary"
          aria-expanded={open}
          aria-controls="search-filters"
          onClick={() => setOpen((v) => !v)}
        >
          Filters{active > 0 && ` (${active})`}
        </button>
      </form>
      {open && (
        <fieldset id="search-filters" className="search-filters">
          <legend>Filters</legend>
          <label>
            Born from{' '}
            <input inputMode="numeric" value={filters.bornFrom} onChange={set('bornFrom')} />
          </label>{' '}
          <label>
            Born to <input inputMode="numeric" value={filters.bornTo} onChange={set('bornTo')} />
          </label>
          <br />
          <label>
            Died from{' '}
            <input inputMode="numeric" value={filters.diedFrom} onChange={set('diedFrom')} />
          </label>{' '}
          <label>
            Died to <input inputMode="numeric" value={filters.diedTo} onChange={set('diedTo')} />
          </label>
          <br />
          <label>
            Place <input value={filters.place} onChange={set('place')} />
          </label>{' '}
          <label>
            Status{' '}
            <select value={filters.status} onChange={set('status')}>
              <option value="">Anyone</option>
              <option value="living">Living</option>
              <option value="deceased">Deceased</option>
            </select>
          </label>
          <PersonPicker
            label="In the branch of"
            persons={persons}
            value={filters.branch || null}
            onChange={(id) => setFilters((f) => ({ ...f, branch: id ?? '' }))}
          />
          {rangeError && <FormError>{rangeError}</FormError>}
          <button type="button" className="secondary" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </button>
        </fieldset>
      )}
      <FormError>{error}</FormError>
      {/* Always mounted, so a screen reader announces each change of its text. */}
      <p role="status" className="sr-only">
        {countText}
      </p>
      {results && (
        <div className="search-results">
          <p aria-hidden="true">{countText}</p>
          <ul aria-label="Search results">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="search-result"
                  onClick={() => {
                    close();
                    void navigate(hrefOf(r.id));
                  }}
                >
                  <PersonPhoto url={r.photoThumbUrl} person={r} className="result-photo" />
                  <span className="result-name">{personName(r)}</span>{' '}
                  <span className="result-years">{personYears(r)}</span>{' '}
                  <span className="result-relation">{relationLabel(r, meId)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
