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
import { formatFuzzyDate, personName, SEX_LABEL } from '../../trees/format';
import { DeletePerson } from './DeletePerson';
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
      <Row label="Died">
        {person.isLiving ? 'Living' : formatFuzzyDate(person.deathDate) || 'Not given'}
      </Row>
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

  return (
    <div>
      {s.saved && !editing && <Success>Saved</Success>}
      <Details person={view.person} />
      {view.capabilities.edit && !editing && (
        <button type="button" className="secondary" onClick={() => setEditing(true)}>
          Edit details
        </button>
      )}
      {editing && <InfoForm view={view} s={s} onClose={() => setEditing(false)} />}
      {view.capabilities.delete && (
        <DeletePerson treeId={treeId} personId={view.person.id} onChanged={props.onChanged} />
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
  deathDate: 'Died',
  isLiving: 'Living',
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
  deathDate: { field: 'deathDate', message: 'Death can’t be before birth' },
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

/** The fields the user changed compared with `p`. */
function changedKeys(f: Form, p: Person): FormKey[] {
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
    const incomplete = draftErrors({ birthDate: form.birth, deathDate: form.death });
    if (Object.keys(incomplete).length > 0) return setErrors(incomplete);
    const v = validate(updatePersonSchema, {
      version: p.version,
      ...Object.fromEntries(TEXT_KEYS.map((k) => [k, form[k]])),
      sex: form.sex,
      birthDate: fromDraft(form.birth),
      deathDate: fromDraft(form.death),
      isLiving: form.isLiving,
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
      <FuzzyDateField
        label="Born"
        name="birthDate"
        value={birth}
        onChange={set('birth')}
        error={errors.birthDate}
      />
      <FuzzyDateField
        label="Died"
        name="deathDate"
        value={death}
        onChange={set('death')}
        error={errors.deathDate}
      />
      <div className="field">
        <label>
          <input
            type="checkbox"
            data-field="isLiving"
            aria-describedby={errors.isLiving ? `${uid}-isLiving-error` : undefined}
            checked={isLiving}
            onChange={(e) => set('isLiving')(e.target.checked)}
          />{' '}
          Living
        </label>
        {errors.isLiving && (
          <p id={`${uid}-isLiving-error`} className="field-error">
            {errors.isLiving}
          </p>
        )}
      </div>
      {field('causeOfDeath', 'Cause of death')}
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
