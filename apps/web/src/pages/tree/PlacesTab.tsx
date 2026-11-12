import {
  type FuzzyDate,
  type Residence,
  type ResidenceInput,
  residenceInputSchema,
  updatePersonSchema,
} from '@family-tree/shared';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { ConfirmButton } from '../../components/ConfirmButton';
import {
  draftErrors,
  FuzzyDateField,
  fromDraft,
  toDraft,
  type FuzzyDraft,
} from '../../components/FuzzyDateField';
import {
  ErrorSummary,
  Field,
  serverFieldErrors,
  FormError,
  Success,
  validate,
  type FieldErrors,
} from '../../components/forms';
import { MenuButton } from '../../components/MenuButton';
import { formatFuzzyDate } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { SelectField } from './RelationSelects';
import { type TabProps, usePersonSave } from './usePersonSave';

const LIVING_DEATH_PLACE =
  'This person is marked as living. To add a death place, tick the box below to mark them as deceased.';
/** The "mark as deceased" error is about the death place, but its fix is the box: it is shown
 *  at the place field and its summary link focuses the box. */
const PLACE_LABELS: Record<string, string> = {
  birthPlace: 'Birth place',
  deathPlace: 'Death place',
  markDeceased: 'Death place',
  place: 'Place',
  fromDate: 'From',
  toDate: 'To',
};
/** Server field keys -> this form's fields, with fixed text (brief #8). The server names
 *  `isLiving`, which this form has no field for: it goes to the box when it is shown. */
const placeFields = (box: boolean): Record<string, { field: string; message: string }> => ({
  isLiving: { field: box ? 'markDeceased' : 'deathPlace', message: LIVING_DEATH_PLACE },
  birthPlace: { field: 'birthPlace', message: 'Check the birth place' },
  deathPlace: { field: 'deathPlace', message: 'Check the death place' },
});

type Kind = 'birth' | 'lived' | 'death';
const BADGE: Record<Kind, string> = { birth: 'Born', lived: 'Lived', death: 'Died' };

interface Row {
  key: string;
  kind: Kind;
  place: string;
  meta: string;
  residence?: Residence;
}

const dateOf = (d: FuzzyDate | null) => formatFuzzyDate(d) ?? '';
const range = (r: Residence) => {
  const from = dateOf(r.fromDate);
  const to = dateOf(r.toDate);
  return from || to ? `${from}–${to}` : '';
};

/** Which form is open: one at a time (brief #7). */
type Open = null | { mode: 'add' } | { mode: 'edit'; key: string };

/** Places as one compact list: born, lived (in the server's order), died (brief #7). */
export function PlacesTab(props: TabProps) {
  const { view, treeId, reload } = props;
  const api = useTreesApi();
  const canEdit = view.capabilities.edit;
  const s = usePersonSave(props);
  const [open, setOpen] = useState<Open>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const alive = useAlive();

  const p = view.person;
  const rows: Row[] = [
    ...(p.birthPlace
      ? [{ key: 'birth', kind: 'birth' as const, place: p.birthPlace, meta: dateOf(p.birthDate) }]
      : []),
    ...view.residences.map((r) => ({
      key: `r:${r.id}`,
      kind: 'lived' as const,
      place: r.place,
      meta: range(r),
      residence: r,
    })),
    ...(p.deathPlace
      ? [{ key: 'death', kind: 'death' as const, place: p.deathPlace, meta: dateOf(p.deathDate) }]
      : []),
  ];

  /** Focus back to the row's menu button, or to Add place. */
  const refocus = (key: string | null) => {
    requestAnimationFrame(() => {
      const trigger = key
        ? list.current?.querySelector<HTMLButtonElement>(`[data-row="${key}"] .menu-trigger`)
        : null;
      (trigger ?? addRef.current)?.focus();
    });
  };
  const close = (key: string | null) => {
    setOpen(null);
    refocus(key);
  };

  async function remove(row: Row) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (row.kind === 'lived') {
      const res = await api.deleteResidence(treeId, row.residence!.id);
      if (!alive.current) return;
      if (!res.ok) {
        setBusy(false);
        return setError(res.error.message);
      }
      await reload();
    } else {
      const res = await s.save(row.kind === 'birth' ? { birthPlace: null } : { deathPlace: null });
      if (!alive.current) return;
      if (!res.ok) {
        setBusy(false);
        return;
      }
    }
    if (!alive.current) return;
    setBusy(false);
    setAsking(null);
    setNotice('Place removed.');
    refocus(null);
  }

  const formFor = (kind: Kind | 'add', row?: Row) => (
    <PlaceForm
      key={row?.key ?? 'add'}
      {...props}
      save={s}
      kinds={
        kind === 'add'
          ? [
              'lived',
              ...(p.birthPlace ? [] : (['birth'] as const)),
              ...(p.deathPlace ? [] : (['death'] as const)),
            ]
          : [kind]
      }
      residence={row?.residence ?? null}
      onCancel={() => close(row?.key ?? null)}
      onDone={() => {
        setNotice(null);
        close(row?.key ?? null);
      }}
    />
  );

  return (
    <div>
      {s.saved && !open && <Success>Saved</Success>}
      {notice && !s.saved && <Success>{notice}</Success>}
      <FormError>{error ?? (open ? null : s.error)}</FormError>
      {rows.length === 0 && <p>No places added yet.</p>}
      <ul className="row-list" aria-label="Places" ref={list}>
        {rows.map((row) => (
          <li key={row.key} data-row={row.key}>
            {open?.mode === 'edit' && open.key === row.key ? (
              <div className="row-form">{formFor(row.kind, row)}</div>
            ) : (
              <>
                <div className="row-main">
                  <span className="badge pill">{BADGE[row.kind]}</span>
                  <strong>{row.place}</strong>
                  {row.meta && <span className="row-meta">{row.meta}</span>}
                </div>
                {canEdit && (
                  <div className="row-actions">
                    {asking === row.key ? (
                      <ConfirmButton
                        startAsking
                        compact
                        label="Remove"
                        confirmLabel="Yes, remove"
                        pending={busy}
                        onConfirm={() => void remove(row)}
                        onCancel={() => {
                          setAsking(null);
                          refocus(row.key);
                        }}
                      />
                    ) : (
                      <MenuButton
                        label={`More actions for ${row.place}`}
                        items={[
                          {
                            label: 'Edit',
                            onSelect: () => {
                              setAsking(null);
                              setOpen({ mode: 'edit', key: row.key });
                            },
                          },
                          {
                            label: 'Remove',
                            danger: true,
                            onSelect: () => {
                              setOpen(null);
                              setAsking(row.key);
                            },
                          },
                        ]}
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {canEdit &&
        (open?.mode === 'add' ? (
          formFor('add')
        ) : (
          <button
            ref={addRef}
            type="button"
            className="secondary compact"
            onClick={() => {
              setAsking(null);
              setOpen({ mode: 'add' });
            }}
          >
            Add place
          </button>
        ))}
    </div>
  );
}

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

const KIND_OPTION: Record<Kind, string> = {
  lived: 'Lived here',
  birth: 'Birth place',
  death: 'Death place',
};

/** One form for adding or editing a place. Its first field takes focus when it opens. */
function PlaceForm({
  treeId,
  view,
  reload,
  save,
  kinds,
  residence,
  onCancel,
  onDone,
}: TabProps & {
  save: ReturnType<typeof usePersonSave>;
  /** The kinds offered (one when editing). */
  kinds: Kind[];
  residence: Residence | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const api = useTreesApi();
  const alive = useAlive();
  const uid = useId();
  const form = useRef<HTMLFormElement>(null);
  const editing = kinds.length === 1 && (kinds[0] !== 'lived' || residence !== null);
  const [kind, setKind] = useState<Kind>(kinds[0]!);
  const p = view.person;
  const initialPlace =
    kind === 'birth' ? (p.birthPlace ?? '') : kind === 'death' ? (p.deathPlace ?? '') : '';
  const [place, setPlace] = useState(residence?.place ?? (editing ? initialPlace : ''));
  const [from, setFrom] = useState<FuzzyDraft>(toDraft(residence?.fromDate ?? null));
  const [to, setTo] = useState<FuzzyDraft>(toDraft(residence?.toDate ?? null));
  const [markDeceased, setMarkDeceased] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    form.current?.querySelector<HTMLElement>('select, input')?.focus();
  }, []);

  // A living person can't have a death place: adding one asks to mark them deceased (#8).
  const asksDeceased =
    kind === 'death' && p.isLiving && (p.deathPlace ?? '').trim() === '' && place.trim() !== '';
  const fieldName = kind === 'birth' ? 'birthPlace' : kind === 'death' ? 'deathPlace' : 'place';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (kind === 'lived') {
      const incomplete = draftErrors({ fromDate: from, toDate: to });
      if (Object.keys(incomplete).length > 0) return setErrors(incomplete);
      const v = validate(residenceInputSchema, {
        place,
        fromDate: fromDraft(from),
        toDate: fromDraft(to),
      });
      if (!v.ok) return setErrors(v.errors);
      setErrors({});
      setPending(true);
      const input: ResidenceInput = v.data;
      const res = residence
        ? await api.updateResidence(treeId, residence.id, input)
        : await api.addResidence(treeId, view.person.id, input);
      if (!alive.current) return;
      setPending(false);
      if (!res.ok) return setError(res.error.message);
      await reload();
      if (alive.current) onDone();
      return;
    }
    const v = validate(updatePersonSchema, { version: p.version, [fieldName]: place });
    if (!v.ok) return setErrors(v.errors);
    if (asksDeceased && !markDeceased) return setErrors({ markDeceased: LIVING_DEATH_PLACE });
    setErrors({});
    const value = (kind === 'birth' ? v.data.birthPlace : v.data.deathPlace) ?? null;
    const res = await save.save({
      [fieldName]: value,
      ...(asksDeceased ? { isLiving: false } : {}),
    });
    if (!alive.current) return;
    if (res.ok) onDone();
    else if (res.fields) setErrors(serverFieldErrors(res.fields, placeFields(asksDeceased)));
  }

  return (
    <form
      ref={form}
      onSubmit={(e) => void submit(e)}
      aria-label={editing ? `Edit ${KIND_OPTION[kind].toLowerCase()}` : 'Add place'}
    >
      <FormError>{error ?? save.error}</FormError>
      <ErrorSummary errors={errors} labels={PLACE_LABELS} />
      {save.stale && (
        <div role="alert" className="error">
          {save.staleMessage}{' '}
          <button type="button" onClick={() => void save.loadLatest()}>
            Load the latest version
          </button>
        </div>
      )}
      {!editing && kinds.length > 1 && (
        <SelectField
          label="Kind"
          value={kind}
          onChange={(k) => {
            setErrors({});
            setKind(k as Kind);
          }}
          options={kinds.map((k) => ({ value: k, label: KIND_OPTION[k] }))}
        />
      )}
      <Field
        label="Place"
        name={fieldName}
        value={place}
        onChange={setPlace}
        error={errors[fieldName] ?? (kind === 'death' ? errors.markDeceased : undefined)}
      />
      {kind === 'lived' && (
        <>
          <FuzzyDateField
            label="From"
            name="fromDate"
            value={from}
            onChange={setFrom}
            error={errors.fromDate}
          />
          <FuzzyDateField
            label="To"
            name="toDate"
            value={to}
            onChange={setTo}
            error={errors.toDate}
          />
        </>
      )}
      {asksDeceased && (
        <div className="field">
          <label>
            <input
              type="checkbox"
              data-field="markDeceased"
              aria-describedby={`${uid}-deceased-hint`}
              aria-invalid={errors.markDeceased ? true : undefined}
              checked={markDeceased}
              onChange={(e) => setMarkDeceased(e.target.checked)}
            />{' '}
            Mark {p.givenName} as deceased
          </label>
          <p id={`${uid}-deceased-hint`} className="hint">
            A death place is only kept for someone who has died.
          </p>
        </div>
      )}
      <p className="actions">
        <button type="submit" disabled={pending || save.pending}>
          {editing ? 'Save place' : 'Add place'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  );
}
