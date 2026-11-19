import { type LinkedPerson, type PersonSummary, RESTRICTED_NOTE } from '@family-tree/shared';
import { useEffect, useState } from 'react';
import { RowContent } from '../../canvas/PanelRow';
import { avatarTone } from '../../canvas/avatar-tone';
import { FormError } from '../../components/forms';
import { IdCardIcon, ImageIcon, MapPinIcon, UsersIcon } from '../../components/icons';
import { PersonPhoto } from '../../components/PersonPhoto';
import { SectionDialog } from '../../components/SectionDialog';
import { PhotoViewer } from '../../photos/PhotoViewer';
import {
  CHILD_KIND_LABEL,
  formatFuzzyDate,
  personName,
  personYears,
  UNION_STATUS_LABEL,
} from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { Details } from './InfoTab';

const SECTIONS = [
  { id: 'info', label: 'Details', Lead: IdCardIcon },
  { id: 'places', label: 'Places', Lead: MapPinIcon },
  { id: 'photos', label: 'Photos', Lead: ImageIcon },
  { id: 'relations', label: 'Relations', Lead: UsersIcon },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const yearOf = (d: { date1: string } | null) => (d ? Number(d.date1.slice(0, 4)) : null);

/**
 * Someone of a linked tree, view-only (tree linking spec L8): their details as the visitor rules
 * allow, with no edit, add or delete anywhere. A relative's name opens them here too.
 */
export function LinkedPersonPanel({
  treeId,
  linkId,
  personId,
  onOpen,
}: {
  treeId: string;
  linkId: string;
  personId: string;
  /** Opens a relative: one of the own tree's (the bridge) or another of the linked tree. */
  onOpen: (personId: string) => void;
}) {
  const api = useTreesApi();
  const [data, setData] = useState<LinkedPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<SectionId | null>(null);
  const [photo, setPhoto] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    void api.linkedPerson(treeId, linkId, personId).then((r) => {
      if (!active) return;
      if (r.ok) setData(r.data);
      else setError(r.error.message);
    });
    return () => {
      active = false;
    };
  }, [api, treeId, linkId, personId]);

  if (error) return <FormError>{error}</FormError>;
  if (!data) return <p>Loading…</p>;
  const { view, tree } = data;
  const p = view.person;
  const name = personName(p);
  const years = personYears({ birthYear: yearOf(p.birthDate), deathYear: yearOf(p.deathDate) });
  const section = SECTIONS.find((s) => s.id === open) ?? null;
  const count = (id: SectionId) =>
    id === 'places'
      ? view.residences.length + (p.birthPlace ? 1 : 0) + (p.deathPlace ? 1 : 0)
      : id === 'photos'
        ? view.photos.length
        : null;
  const who = (x: PersonSummary) => (
    <button type="button" className="link-button" onClick={() => onOpen(x.id)}>
      {personName(x)}
    </button>
  );

  return (
    <div className="person-panel is-linked-tree">
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
        </h2>
        <p className="linked-tree-tag">
          <span className="name-tag pill">{tree.name}</span> View only
        </p>
        {p.restricted && <p className="restricted-note">{RESTRICTED_NOTE}.</p>}
      </div>
      <ul className="section-list" aria-label={`Sections for ${name}`}>
        {SECTIONS.filter((s) => !p.restricted || s.id === 'info' || s.id === 'relations').map(
          (s) => (
            <li key={s.id}>
              <button
                type="button"
                className="section-row"
                aria-haspopup="dialog"
                onClick={() => setOpen(s.id)}
              >
                <RowContent title={s.label} count={count(s.id)} lead={<s.Lead />} />
              </button>
            </li>
          ),
        )}
      </ul>
      {section && (
        <SectionDialog title={`${section.label} — ${name}`} onClose={() => setOpen(null)}>
          {section.id === 'info' && <Details person={p} privacy={null} />}
          {section.id === 'places' && (
            <ul className="plain-list">
              {p.birthPlace && <li>Born in {p.birthPlace}</li>}
              {view.residences.map((r) => (
                <li key={r.id}>
                  Lived in {r.place}
                  {(r.fromDate || r.toDate) &&
                    ` (${formatFuzzyDate(r.fromDate) || '?'} – ${formatFuzzyDate(r.toDate) || '?'})`}
                </li>
              ))}
              {p.deathPlace && <li>Passed away in {p.deathPlace}</li>}
              {count('places') === 0 && <li>No places recorded.</li>}
            </ul>
          )}
          {section.id === 'photos' &&
            (view.photos.length === 0 ? (
              <p>No photos.</p>
            ) : (
              <ul className="photo-grid">
                {view.photos.map((ph, i) => (
                  <li key={ph.id}>
                    <button
                      type="button"
                      className="photo-open"
                      aria-haspopup="dialog"
                      aria-label={`Open photo ${i + 1} of ${view.photos.length}`}
                      onClick={() => setPhoto(i)}
                    >
                      <img src={ph.thumbUrl} alt="" className="photo-thumb" />
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          {section.id === 'relations' && (
            <dl>
              {view.relations.parents.map((r) => (
                <div key={r.linkId}>
                  <dt>Parents ({CHILD_KIND_LABEL[r.kind]})</dt>
                  <dd>
                    {r.parents.length === 0
                      ? 'Unknown'
                      : r.parents.map((x, i) => (
                          <span key={x.id}>
                            {i > 0 && ' and '}
                            {who(x)}
                          </span>
                        ))}
                  </dd>
                </div>
              ))}
              {view.relations.unions.map((u) => (
                <div key={u.id}>
                  <dt>{UNION_STATUS_LABEL[u.status]}</dt>
                  <dd>
                    {u.partner ? who(u.partner) : 'Unknown partner'}
                    {u.children.length > 0 && (
                      <>
                        {'; children: '}
                        {u.children.map((c, i) => (
                          <span key={c.linkId}>
                            {i > 0 && ', '}
                            {who(c.person)}
                          </span>
                        ))}
                      </>
                    )}
                  </dd>
                </div>
              ))}
              {view.relations.siblings.length > 0 && (
                <div>
                  <dt>Siblings</dt>
                  <dd>
                    {view.relations.siblings.map((x, i) => (
                      <span key={x.person.id}>
                        {i > 0 && ', '}
                        {who(x.person)}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </SectionDialog>
      )}
      {photo !== null && (
        <PhotoViewer
          photos={view.photos}
          start={photo}
          name={name}
          onClose={() => setPhoto(null)}
        />
      )}
    </div>
  );
}
