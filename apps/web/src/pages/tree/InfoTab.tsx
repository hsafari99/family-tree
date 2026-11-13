import {
  personConsistencyErrors,
  type PersonView,
  SEXES,
  updatePersonSchema,
} from '@family-tree/shared';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
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
import { EditIcon, TrashIcon } from '../../components/icons';
import { formatFuzzyDate, lifeStatus, personName, SEX_LABEL } from '../../trees/format';
import { DeletePerson } from './DeletePerson';
import { MainPhoto } from './MainPhoto';
import { type TabProps, usePersonSave } from './usePersonSave';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Details({ person }: { person: PersonView['person'] }) {
  return (
    <dl>
      <Row label="Name">{personName(person)}</Row>
      <Row label="Sex">{SEX_LABEL[person.sex]}</Row>
      {person.birthDate && <Row label="Born">{formatFuzzyDate(person.birthDate)}</Row>}
      <Row label="Status">{lifeStatus(person.isLiving, person.deathDate)}</Row>
      {person.causeOfDeath && <Row label="Cause of death">{person.causeOfDeath}</Row>}
      {person.occupation && <Row label="Occupation">{person.occupation}</Row>}
      {person.education && <Row label="Education">{person.education}</Row>}
      {person.biography && (
        <Row label="Biography">
          <p className="prose">{person.biography}</p>
        </Row>
      )}
      {person.notes && (
        <Row label="Notes">
          <p className="prose">{person.notes}</p>
        </Row>
      )}
      {person.createdByName && <Row label="Added by">{person.createdByName}</Row>}
    </dl>
  );
}

export function InfoTab(props: TabProps) {
  const { view, treeId } = props;
  const s = usePersonSave(props);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const { edit, delete: canDelete } = view.capabilities;

  return (
    <div className="info-tab">
      {s.saved && !editing && <Success>Saved</Success>}
      {/* Where there is room (the Details dialog), the photo sits to the right of the details
          instead of above them; in the narrow side panel it stays on top. */}
      <div className="info-top">
        <MainPhoto {...props} />
        <Details person={view.person} />
      </div>
      {/* One row: Edit on the left, Delete… on the right; each only when allowed. */}
      {!editing && (edit || canDelete) && (
        <p className="detail-actions">
          {edit && (
            <button
              type="button"
              className="secondary"
              // The visible words start the name (WCAG 2.5.3); the name says what is edited.
              aria-label="Edit details"
              onClick={() => {
                setDeleting(false);
                setEditing(true);
              }}
            >
              <EditIcon /> Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              ref={deleteButton}
              className="secondary danger"
              aria-label="Delete this person…"
              aria-expanded={deleting}
              onClick={() => setDeleting((d) => !d)}
            >
              <TrashIcon /> Delete…
            </button>
          )}
        </p>
      )}
      {editing && <InfoForm view={view} s={s} onClose={() => setEditing(false)} />}
      {canDelete && deleting && !editing && (
        <DeletePerson
          treeId={treeId}
          personId={view.person.id}
          onChanged={props.onChanged}
          onCancel={() => {
            setDeleting(false);
            deleteButton.current?.focus();
          }}
        />
      )}
    </div>
  );
}

type Person = PersonView['person'];
const TEXT_KEYS = [
  'givenName',
  'middleName',
  'surname',
  'maidenName',
  'nickname',
  'causeOfDeath',
  'occupation',
  'education',
  'biography',
  'notes',
] as const;

interface Form {
  givenName: string;
  middleName: string;
  surname: string;
  maidenName: string;
  nickname: string;
  causeOfDeath: string;
  occupation: string;
  education: string;
  biography: string;
  notes: string;
  sex: string;
  birth: FuzzyDraft;
  death: FuzzyDraft;
  isLiving: boolean;
}
type FormKey = keyof Form;
/** The error summary's names for this form's fields (#8). */
const INFO_LABELS: Record<string, string> = {
  givenName: 'First name',
  middleName: 'Middle name',
  surname: 'Last name',
  maidenName: 'Maiden name',
  nickname: 'Nickname',
  sex: 'Sex',
  birthDate: 'Born',
  deathDate: 'Date of death',
  isLiving: 'Status',
  causeOfDeath: 'Cause of death',
  occupation: 'Occupation',
  education: 'Education',
  biography: 'Biography',
  notes: 'Notes',
};
/** The person field each form field edits. */
const PERSON_KEY = { birth: 'birthDate', death: 'deathDate' } as const;
const personKey = (k: FormKey) => (k === 'birth' || k === 'death' ? PERSON_KEY[k] : k);

/** Server field keys -> this form's fields, with our own fixed text (never the server's). */
const INFO_FIELDS: Record<string, { field: string; message: string }> = {
  ...Object.fromEntries(
    Object.keys(INFO_LABELS).map((k) => [k, { field: k, message: 'Check this and try again' }]),
  ),
  isLiving: { field: 'isLiving', message: 'Someone with death details can’t be marked as living' },
  // The server names only the field, so the text covers each rule a date can break.
  birthDate: { field: 'birthDate', message: 'Check the birth date. It can’t be in the future.' },
  deathDate: {
    field: 'deathDate',
    message: 'Check the death date. It can’t be before birth or in the future.',
  },
};

const toForm = (p: Person): Form => ({
  givenName: p.givenName,
  middleName: p.middleName ?? '',
  surname: p.surname ?? '',
  maidenName: p.maidenName ?? '',
  nickname: p.nickname ?? '',
  causeOfDeath: p.causeOfDeath ?? '',
  occupation: p.occupation ?? '',
  education: p.education ?? '',
  biography: p.biography ?? '',
  notes: p.notes ?? '',
  sex: p.sex,
  birth: toDraft(p.birthDate),
  death: toDraft(p.deathDate),
  isLiving: p.isLiving,
});

/** A comparable form of a field's value (text is compared trimmed, dates as the value sent). */
function norm(f: Form, k: FormKey): string {
  const v = f[k];
  if (k === 'birth' || k === 'death') return JSON.stringify(fromDraft(f[k]));
  return typeof v === 'string' ? v.trim() : String(v);
}

const NO_DATE = toDraft(null);
/** What is saved: a living person's (hidden) death fields are cleared. */
const effective = (f: Form): Form => (f.isLiving ? { ...f, death: NO_DATE, causeOfDeath: '' } : f);

/** The fields the user changed compared with `p` (as saved: see `effective`). */
function changedKeys(form: Form, p: Person): FormKey[] {
  const f = effective(form);
  const base = toForm(p);
  return (Object.keys(f) as FormKey[]).filter((k) => norm(f, k) !== norm(base, k));
}

function InfoForm({
  view,
  s,
  onClose,
}: {
  view: PersonView;
  s: ReturnType<typeof usePersonSave>;
  onClose: () => void;
}) {
  const uid = useId();
  const p = view.person;
  const [form, setForm] = useState<Form>(() => toForm(p));
  const base = useRef(p);
  const [errors, setErrors] = useState<FieldErrors>({});

  // The person was reloaded (after a stale save): re-base on it and keep only the user's own
  // changes, so the retry doesn't overwrite what someone else changed.
  useEffect(() => {
    if (p.version === base.current.version) return;
    const mine = changedKeys(form, base.current);
    const latest = toForm(p);
    setForm((f) => {
      const next = { ...latest };
      for (const k of mine) (next as Record<FormKey, unknown>)[k] = f[k];
      return next;
    });
    base.current = p;
  }, [p]);

  const set =
    <K extends FormKey>(k: K) =>
    (v: Form[K]) =>
      setForm((f) => ({ ...f, [k]: v }));
  const sex = form.sex;
  const birth = form.birth;
  const death = form.death;
  const isLiving = form.isLiving;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const changed = changedKeys(form, p);
    if (changed.length === 0) return onClose();
    const out = effective(form);
    const incomplete = draftErrors({ birthDate: out.birth, deathDate: out.death });
    if (Object.keys(incomplete).length > 0) return setErrors(incomplete);
    const v = validate(updatePersonSchema, {
      version: p.version,
      ...Object.fromEntries(TEXT_KEYS.map((k) => [k, out[k]])),
      sex: out.sex,
      // Only a changed date is checked: a stored one (even a wrong one) never blocks a save.
      ...(changed.includes('birth') ? { birthDate: fromDraft(out.birth) } : {}),
      ...(changed.includes('death') ? { deathDate: fromDraft(out.death) } : {}),
      isLiving: out.isLiving,
    });
    if (!v.ok) return setErrors(v.errors);
    const data = v.data as Record<string, unknown>;
    // Only what the user changed: the server merges it into the latest record.
    const fields = Object.fromEntries(changed.map((k) => [personKey(k), data[personKey(k)]]));
    const consistency = personConsistencyErrors({ ...p, ...fields });
    if (Object.keys(consistency).length > 0) {
      return setErrors(Object.fromEntries(Object.entries(consistency).map(([k, m]) => [k, m[0]])));
    }
    setErrors({});
    const res = await s.save(fields);
    if (res.ok) onClose();
    else if (res.fields) setErrors(serverFieldErrors(res.fields, INFO_FIELDS));
  }

  const area = (k: 'biography' | 'notes', label: string) => (
    <div className="field">
      <label htmlFor={`${uid}-${k}`}>{label}</label>
      <textarea
        id={`${uid}-${k}`}
        rows={5}
        data-field={k}
        value={form[k]}
        onChange={(e) => set(k)(e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
        aria-describedby={errors[k] ? `${uid}-${k}-error` : undefined}
      />
      {errors[k] && (
        <p id={`${uid}-${k}-error`} className="field-error">
          {errors[k]}
        </p>
      )}
    </div>
  );
  const field = (k: (typeof TEXT_KEYS)[number], label: string) => (
    <Field label={label} name={k} value={form[k]} onChange={set(k)} error={errors[k]} />
  );

  return (
    <form onSubmit={(e) => void submit(e)}>
      <FormError>{s.error}</FormError>
      <ErrorSummary errors={errors} labels={INFO_LABELS} />
      {s.stale && (
        <div role="alert" className="error">
          {s.staleMessage} Your changes are still in the form below.{' '}
          <button type="button" onClick={() => void s.loadLatest()}>
            Load the latest version
          </button>
        </div>
      )}
      {field('givenName', 'First name')}
      {field('middleName', 'Middle name')}
      {field('surname', 'Last name')}
      {field('maidenName', 'Maiden name')}
      {field('nickname', 'Nickname')}
      <div className="field">
        <label htmlFor={`${uid}-sex`}>Sex</label>
        <select
          id={`${uid}-sex`}
          data-field="sex"
          value={sex}
          onChange={(e) => set('sex')(e.target.value)}
        >
          {SEXES.map((x) => (
            <option key={x} value={x}>
              {SEX_LABEL[x]}
            </option>
          ))}
        </select>
      </div>
      {/* Living | Deceased, before the dates; Deceased shows the death fields (hidden ones are
          cleared on save). */}
      <fieldset
        className="field status-field"
        role="radiogroup"
        aria-describedby={errors.isLiving ? `${uid}-isLiving-error` : undefined}
      >
        <legend>Status</legend>
        <div className="segmented">
          {([true, false] as const).map((living) => (
            <label key={String(living)} className="segment">
              <input
                type="radio"
                name={`${uid}-status`}
                // The error summary jumps to the chosen option.
                data-field={living === isLiving ? 'isLiving' : undefined}
                aria-invalid={errors.isLiving ? true : undefined}
                checked={living === isLiving}
                onChange={() => set('isLiving')(living)}
              />
              {living ? 'Living' : 'Deceased'}
            </label>
          ))}
        </div>
        {errors.isLiving && (
          <p id={`${uid}-isLiving-error`} className="field-error">
            {errors.isLiving}
          </p>
        )}
      </fieldset>
      <FuzzyDateField
        label="Born"
        name="birthDate"
        value={birth}
        onChange={set('birth')}
        error={errors.birthDate}
      />
      {!isLiving && (
        <>
          <FuzzyDateField
            label="Date of death (optional)"
            name="deathDate"
            value={death}
            onChange={set('death')}
            error={errors.deathDate}
          />
          {field('causeOfDeath', 'Cause of death (optional)')}
        </>
      )}
      {field('occupation', 'Occupation')}
      {field('education', 'Education')}
      {area('biography', 'Biography')}
      {area('notes', 'Notes')}
      <p className="actions">
        <button type="submit" disabled={s.pending}>
          Save
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
      </p>
    </form>
  );
}
