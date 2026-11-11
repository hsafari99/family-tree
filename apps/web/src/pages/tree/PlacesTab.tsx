import {
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
import { formatFuzzyDate } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { type TabProps, usePersonSave } from './usePersonSave';

const LIVING_DEATH_PLACE =
  'This person is marked as living. To add a death place, tick the box below to mark them as deceased.';
/** The "mark as deceased" error is about the death place, but its fix is the box: it is shown
 *  at the death place and its summary link focuses the box. */
const PLACE_LABELS: Record<string, string> = {
  birthPlace: 'Birth place',
  deathPlace: 'Death place',
  markDeceased: 'Death place',
};
/** Server field keys -> this form's fields, with fixed text (brief #8). The server names
 *  `isLiving`, which this form has no field for: it goes to the box when it is shown. */
const placeFields = (box: boolean): Record<string, { field: string; message: string }> => ({
  isLiving: { field: box ? 'markDeceased' : 'deathPlace', message: LIVING_DEATH_PLACE },
  birthPlace: { field: 'birthPlace', message: 'Check the birth place' },
  deathPlace: { field: 'deathPlace', message: 'Check the death place' },
});

export function PlacesTab(props: TabProps) {
  const { view } = props;
  const canEdit = view.capabilities.edit;
  const s = usePersonSave(props);
  const [editing, setEditing] = useState(false);
  const [birthPlace, setBirthPlace] = useState('');
  const [deathPlace, setDeathPlace] = useState('');
  const [markDeceased, setMarkDeceased] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const uid = useId();

  // What the form was opened from: only fields the user changed are saved.
  const opened = useRef({ birth: '', death: '' });

  function open() {
    opened.current = {
      birth: (view.person.birthPlace ?? '').trim(),
      death: (view.person.deathPlace ?? '').trim(),
    };
    setBirthPlace(view.person.birthPlace ?? '');
    setDeathPlace(view.person.deathPlace ?? '');
    setMarkDeceased(false);
    setErrors({});
    setEditing(true);
  }

  // A living person can't have a death place: adding one asks to mark them deceased (#8).
  const asksDeceased =
    view.person.isLiving && opened.current.death === '' && deathPlace.trim() !== '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validate(updatePersonSchema, {
      version: view.person.version,
      birthPlace,
      deathPlace,
    });
    if (!v.ok) return setErrors(v.errors);
    if (asksDeceased && !markDeceased) return setErrors({ markDeceased: LIVING_DEATH_PLACE });
    setErrors({});
    const fields = {
      ...(birthPlace.trim() !== opened.current.birth ? { birthPlace: v.data.birthPlace } : {}),
      ...(deathPlace.trim() !== opened.current.death ? { deathPlace: v.data.deathPlace } : {}),
      ...(asksDeceased ? { isLiving: false } : {}),
    };
    if (Object.keys(fields).length === 0) return setEditing(false);
    const res = await s.save(fields);
    if (res.ok) setEditing(false);
    else if (res.fields) setErrors(serverFieldErrors(res.fields, placeFields(asksDeceased)));
  }

  return (
    <div>
      {s.saved && !editing && <Success>Saved</Success>}
      <dl>
        <dt>Birth place</dt>
        <dd>{view.person.birthPlace ?? 'Not given'}</dd>
        <dt>Death place</dt>
        <dd>{view.person.deathPlace ?? 'Not given'}</dd>
      </dl>
      {canEdit && !editing && (
        <button type="button" className="secondary" onClick={open}>
          Edit places
        </button>
      )}
      {editing && (
        <form onSubmit={(e) => void submit(e)}>
          <FormError>{s.error}</FormError>
          <ErrorSummary errors={errors} labels={PLACE_LABELS} />
          {s.stale && (
            <div role="alert" className="error">
              {s.staleMessage}{' '}
              <button type="button" onClick={() => void s.loadLatest()}>
                Load the latest version
              </button>
            </div>
          )}
          <Field
            label="Birth place"
            name="birthPlace"
            value={birthPlace}
            onChange={setBirthPlace}
            error={errors.birthPlace}
          />
          <Field
            label="Death place"
            name="deathPlace"
            value={deathPlace}
            onChange={setDeathPlace}
            error={errors.deathPlace ?? errors.markDeceased}
          />
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
                Mark {view.person.givenName} as deceased
              </label>
              <p id={`${uid}-deceased-hint`} className="hint">
                A death place is only kept for someone who has died.
              </p>
            </div>
          )}
          <p className="actions">
            <button type="submit" disabled={s.pending}>
              Save places
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </p>
        </form>
      )}

      <h3>Places lived</h3>
      {view.residences.length === 0 && <p>No places added yet.</p>}
      <ul>
        {view.residences.map((r) => (
          <ResidenceRow key={r.id} {...props} residence={r} />
        ))}
      </ul>
      {canEdit && <ResidenceAdd {...props} />}
    </div>
  );
}

const range = (r: Residence) => {
  const from = formatFuzzyDate(r.fromDate);
  const to = formatFuzzyDate(r.toDate);
  return from || to ? `, ${from}–${to}` : '';
};

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

function ResidenceRow({ treeId, view, reload, residence }: TabProps & { residence: Residence }) {
  const api = useTreesApi();
  const alive = useAlive();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [removing, setRemoving] = useState(false);

  async function remove() {
    if (removing) return;
    setError(null);
    setRemoving(true);
    const res = await api.deleteResidence(treeId, residence.id);
    if (!alive.current) return;
    if (!res.ok) {
      setRemoving(false);
      return setError(res.error.message);
    }
    await reload();
    if (alive.current) setRemoving(false);
  }

  return (
    <li>
      <FormError>{error}</FormError>
      {editing ? (
        <ResidenceForm
          initial={residence}
          submitLabel="Save place"
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            const res = await api.updateResidence(treeId, residence.id, input);
            if (!res.ok) return res.error.message;
            await reload();
            if (alive.current) setEditing(false);
            return null;
          }}
        />
      ) : (
        <>
          {residence.place}
          {range(residence)}
          {view.capabilities.edit && (
            <span className="actions">
              <button type="button" className="secondary" onClick={() => setEditing(true)}>
                Edit
              </button>
              <ConfirmButton
                label="Remove"
                pending={removing}
                confirmLabel="Yes, remove"
                onConfirm={() => void remove()}
              />
            </span>
          )}
        </>
      )}
    </li>
  );
}

function ResidenceAdd({ treeId, view, reload }: TabProps) {
  const api = useTreesApi();
  const alive = useAlive();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        Add a place
      </button>
    );
  }
  return (
    <ResidenceForm
      initial={null}
      submitLabel="Add place"
      onCancel={() => setOpen(false)}
      onSubmit={async (input) => {
        const res = await api.addResidence(treeId, view.person.id, input);
        if (!res.ok) return res.error.message;
        await reload();
        if (alive.current) setOpen(false);
        return null;
      }}
    />
  );
}

const RESIDENCE_LABELS: Record<string, string> = {
  place: 'Place',
  fromDate: 'From',
  toDate: 'To',
};

function ResidenceForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Residence | null;
  submitLabel: string;
  /** Returns an error message, or null on success. */
  onSubmit: (input: ResidenceInput) => Promise<string | null>;
  onCancel: () => void;
}) {
  const alive = useAlive();
  const [place, setPlace] = useState(initial?.place ?? '');
  const [from, setFrom] = useState<FuzzyDraft>(toDraft(initial?.fromDate ?? null));
  const [to, setTo] = useState<FuzzyDraft>(toDraft(initial?.toDate ?? null));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const incomplete = draftErrors({ fromDate: from, toDate: to });
    if (Object.keys(incomplete).length > 0) return setErrors(incomplete);
    const v = validate(residenceInputSchema, {
      place,
      fromDate: fromDraft(from),
      toDate: fromDraft(to),
    });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setError(null);
    setPending(true);
    const message = await onSubmit(v.data);
    if (!alive.current) return;
    setPending(false);
    if (message) setError(message);
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <FormError>{error}</FormError>
      <ErrorSummary errors={errors} labels={RESIDENCE_LABELS} />
      <Field label="Place" name="place" value={place} onChange={setPlace} error={errors.place} />
      <FuzzyDateField
        label="From"
        name="fromDate"
        value={from}
        onChange={setFrom}
        error={errors.fromDate}
      />
      <FuzzyDateField label="To" name="toDate" value={to} onChange={setTo} error={errors.toDate} />
      <p className="actions">
        <button type="submit" disabled={pending}>
          {submitLabel}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  );
}
