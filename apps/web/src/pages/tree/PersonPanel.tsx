import type { PersonSummary, PersonView } from '@family-tree/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FormError } from '../../components/forms';
import { PersonPhoto, PhotoRefreshContext, useThrottled } from '../../components/PersonPhoto';
import { ChevronIcon, SectionDialog } from '../../components/SectionDialog';
import { personName, personYears } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { HistoryTab } from './HistoryTab';
import { InfoTab } from './InfoTab';
import { PhotosTab } from './PhotosTab';
import { PlacesTab } from './PlacesTab';
import { RelationsTab } from './RelationsTab';

/** The panel's sections. Each opens in a dialog; `?tab=<id>` deep-links to one (brief #15). */
export const SECTIONS = [
  { id: 'info', label: 'Details' },
  { id: 'places', label: 'Places' },
  { id: 'photos', label: 'Photos' },
  { id: 'relations', label: 'Relations' },
  { id: 'history', label: 'History' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const yearOf = (d: { date1: string } | null) => (d ? Number(d.date1.slice(0, 4)) : null);
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A one-line summary under each section heading, from data the panel already has. */
export function sectionSummary(id: SectionId, view: PersonView): string {
  const p = view.person;
  switch (id) {
    case 'info':
      return 'Names, dates and biography';
    case 'places': {
      const n = view.residences.length + (p.birthPlace ? 1 : 0) + (p.deathPlace ? 1 : 0);
      return n === 0 ? 'No places yet' : count(n, 'place');
    }
    case 'photos':
      return view.photos.length === 0 ? 'No photos yet' : count(view.photos.length, 'photo');
    case 'relations': {
      const r = view.relations;
      const parts = [
        ...(r.parents.some((u) => u.parents.length > 0) ? ['Parents'] : []),
        ...(r.unions.some((u) => u.partner)
          ? [count(r.unions.filter((u) => u.partner).length, 'partner')]
          : []),
        ...(r.unions.some((u) => u.children.length > 0)
          ? [
              count(
                r.unions.reduce((n, u) => n + u.children.length, 0),
                'child',
                'children',
              ),
            ]
          : []),
        ...(r.siblings.length > 0 ? [count(r.siblings.length, 'sibling')] : []),
      ];
      return parts.length === 0 ? 'No relatives yet' : parts.join(', ');
    }
    case 'history':
      return 'Changes to this person';
  }
}

export function PersonPanel({
  treeId,
  personId,
  persons,
  onChanged,
}: {
  treeId: string;
  personId: string;
  persons: PersonSummary[];
  onChanged: () => void;
}) {
  const api = useTreesApi();
  const [view, setView] = useState<PersonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const alive = useRef(true);
  const rows = useRef(new Map<SectionId, HTMLButtonElement>());

  const load = useCallback(async () => {
    const res = await api.getPerson(treeId, personId);
    if (!alive.current) return;
    if (res.ok) {
      setView(res.data);
      setError(null);
    } else setError(res.error.message);
  }, [api, treeId, personId]);

  useEffect(() => {
    alive.current = true;
    setView(null);
    setError(null);
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const refreshPhotos = useThrottled(() => void load());

  // Whichever way a section's dialog closes (X, Esc, or a finished add), focus goes back to its
  // heading in the panel, unless something else on the page already has it.
  const openId = view ? (SECTIONS.find((t) => t.id === params.get('tab'))?.id ?? null) : null;
  const wasOpen = useRef<SectionId | null>(null);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = openId;
    if (!was || openId) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) rows.current.get(was)?.focus();
  }, [openId]);

  const setSection = useCallback(
    (id: SectionId | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (id) next.set('tab', id);
          else next.delete('tab');
          next.delete('add');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  if (error && !view) {
    return (
      <div>
        <FormError>{error}</FormError>
        <p>
          <Link to={`/trees/${treeId}`}>Back to the list</Link>
        </p>
      </div>
    );
  }
  if (!view) return <p>Loading…</p>;

  const open = SECTIONS.find((t) => t.id === openId) ?? null;
  const p = view.person;
  const name = personName(p);
  const years = personYears({ birthYear: yearOf(p.birthDate), deathYear: yearOf(p.deathDate) });
  const tabProps = { treeId, view, reload: load, onChanged };
  const close = () => setSection(null);

  return (
    <PhotoRefreshContext.Provider value={refreshPhotos}>
      <div className="person-panel">
        {error && <FormError>{error}</FormError>}
        <div className="person-summary">
          <PersonPhoto
            url={view.photos.find((x) => x.isPrimary)?.thumbUrl ?? null}
            person={p}
            className="panel-photo"
          />
          <h2>
            {name}
            {years && ` ${years}`}
          </h2>
          {p.nickname && <p>“{p.nickname}”</p>}
          {p.maidenName && <p>Maiden name: {p.maidenName}</p>}
        </div>
        <ul className="section-list" aria-label={`Sections for ${name}`}>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="section-row"
                aria-haspopup="dialog"
                ref={(el) => {
                  if (el) rows.current.set(s.id, el);
                  else rows.current.delete(s.id);
                }}
                onClick={() => setSection(s.id)}
              >
                <span className="section-row-text">
                  <span className="section-row-title">{s.label}</span>
                  <span className="section-row-summary">{sectionSummary(s.id, view)}</span>
                </span>
                <ChevronIcon />
              </button>
            </li>
          ))}
        </ul>
        {open && (
          <SectionDialog title={`${open.label} — ${name}`} onClose={close}>
            {open.id === 'info' && <InfoTab {...tabProps} />}
            {open.id === 'places' && <PlacesTab {...tabProps} />}
            {open.id === 'photos' && <PhotosTab {...tabProps} />}
            {open.id === 'relations' && <RelationsTab {...tabProps} persons={persons} />}
            {open.id === 'history' && <HistoryTab treeId={treeId} personId={personId} />}
          </SectionDialog>
        )}
      </div>
    </PhotoRefreshContext.Provider>
  );
}
