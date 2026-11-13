import type { PersonSummary, PersonView } from '@family-tree/shared';
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FormError } from '../../components/forms';
import { PersonPhoto, PhotoRefreshContext, useThrottled } from '../../components/PersonPhoto';
import { RowContent } from '../../canvas/PanelRow';
import { ClockIcon, IdCardIcon, ImageIcon, MapPinIcon, UsersIcon } from '../../components/icons';
import { avatarTone } from '../../canvas/avatar-tone';
import { SectionDialog } from '../../components/SectionDialog';
import { personName, personYears } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { HistoryTab } from './HistoryTab';
import { InfoTab } from './InfoTab';
import { PhotosTab } from './PhotosTab';
import { PlacesTab } from './PlacesTab';
import { RelationsTab } from './RelationsTab';

/** The panel's sections. Each opens in a dialog; `?tab=<id>` deep-links to one (brief #15). */
export const SECTIONS = [
  { id: 'info', label: 'Details', Lead: IdCardIcon },
  { id: 'places', label: 'Places', Lead: MapPinIcon },
  { id: 'photos', label: 'Photos', Lead: ImageIcon },
  { id: 'relations', label: 'Relations', Lead: UsersIcon },
  { id: 'history', label: 'History', Lead: ClockIcon },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const yearOf = (d: { date1: string } | null) => (d ? Number(d.date1.slice(0, 4)) : null);

/** The small count at the end of a section's row, where one helps: places and photos. */
export function sectionCount(id: SectionId, view: PersonView): number | null {
  const p = view.person;
  if (id === 'places')
    return view.residences.length + (p.birthPlace ? 1 : 0) + (p.deathPlace ? 1 : 0);
  if (id === 'photos') return view.photos.length;
  return null;
}

export function PersonPanel({
  treeId,
  personId,
  persons,
  onChanged,
  tags = [],
  account,
}: {
  treeId: string;
  personId: string;
  persons: PersonSummary[];
  onChanged: () => void;
  /** Shown after the name, e.g. the member's own role or "Starting person". */
  tags?: readonly string[];
  /** Under the name: whose account this person is, invite and "This is me" (PersonAccount). */
  account?: (view: PersonView) => ReactNode;
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
            tone={avatarTone(p.id)}
          />
          <h2>
            {name}
            {years && ` ${years}`}
            {tags.length > 0 && (
              <>
                {' '}
                {/* Pills in one row under the name; a screen reader hears "(Owner)" as part of
                    the heading. */}
                <span className="name-tags">
                  {tags.map((t) => (
                    <Fragment key={t}>
                      {' '}
                      <span className="name-tag pill">
                        <span className="name-tag-paren">(</span>
                        {t}
                        <span className="name-tag-paren">)</span>
                      </span>
                    </Fragment>
                  ))}
                </span>
              </>
            )}
          </h2>
          {p.nickname && <p>“{p.nickname}”</p>}
          {p.maidenName && <p>Maiden name: {p.maidenName}</p>}
          {account?.(view)}
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
                <RowContent title={s.label} count={sectionCount(s.id, view)} lead={<s.Lead />} />
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
