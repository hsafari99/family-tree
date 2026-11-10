import type { PersonSummary, PersonView } from '@family-tree/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FormError } from '../../components/forms';
import { PersonPhoto, PhotoRefreshContext, useThrottled } from '../../components/PersonPhoto';
import { Tabs } from '../../components/Tabs';
import { personName, personYears } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { HistoryTab } from './HistoryTab';
import { InfoTab } from './InfoTab';
import { PhotosTab } from './PhotosTab';
import { PlacesTab } from './PlacesTab';
import { RelationsTab } from './RelationsTab';

const TABS = [
  { id: 'info', label: 'Info' },
  { id: 'places', label: 'Places' },
  { id: 'photos', label: 'Photos' },
  { id: 'relations', label: 'Relations' },
  { id: 'history', label: 'History' },
] as const;

const yearOf = (d: { date1: string } | null) => (d ? Number(d.date1.slice(0, 4)) : null);

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

  const raw = params.get('tab');
  const tab = TABS.find((t) => t.id === raw)?.id ?? 'info';
  const p = view.person;
  const years = personYears({ birthYear: yearOf(p.birthDate), deathYear: yearOf(p.deathDate) });
  const tabProps = { treeId, view, reload: load, onChanged };

  return (
    <PhotoRefreshContext.Provider value={refreshPhotos}>
      <div className="person-panel">
        {error && <FormError>{error}</FormError>}
        <PersonPhoto
          url={view.photos.find((x) => x.isPrimary)?.thumbUrl ?? null}
          person={p}
          className="panel-photo"
        />
        <h2>
          {personName(p)}
          {years && ` ${years}`}
        </h2>
        {p.nickname && <p>“{p.nickname}”</p>}
        {p.maidenName && <p>Maiden name: {p.maidenName}</p>}
        <Tabs
          tabs={TABS}
          current={tab}
          onChange={(id) =>
            setParams(
              (p) => {
                const next = new URLSearchParams(p);
                next.set('tab', id);
                next.delete('add');
                return next;
              },
              { replace: true },
            )
          }
        />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'info' && <InfoTab {...tabProps} />}
          {tab === 'places' && <PlacesTab {...tabProps} />}
          {tab === 'photos' && <PhotosTab {...tabProps} />}
          {tab === 'relations' && <RelationsTab {...tabProps} persons={persons} />}
          {tab === 'history' && <HistoryTab treeId={treeId} personId={personId} />}
        </div>
      </div>
    </PhotoRefreshContext.Provider>
  );
}
