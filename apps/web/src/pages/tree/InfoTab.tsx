import {
  personConsistencyErrors,
  type PersonView,
  SEXES,
  updatePersonSchema,
} from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import {
  FuzzyDateField,
  fromDraft,
  toDraft,
  type FuzzyDraft,
} from '../../components/FuzzyDateField';
import { Field, FormError, Success, validate, type FieldErrors } from '../../components/forms';
import { formatFuzzyDate, personName, SEX_LABEL } from '../../trees/format';
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
  const { view } = props;
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
    </div>
  );
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
  const p = view.person;
  const [text, setText] = useState({
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
  });
  const [sex, setSex] = useState<string>(p.sex);
  const [birth, setBirth] = useState<FuzzyDraft>(toDraft(p.birthDate));
  const [death, setDeath] = useState<FuzzyDraft>(toDraft(p.deathDate));
  const [isLiving, setIsLiving] = useState(p.isLiving);
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof text) => (v: string) => setText((t) => ({ ...t, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validate(updatePersonSchema, {
      version: p.version,
      ...text,
      sex,
      birthDate: fromDraft(birth),
      deathDate: fromDraft(death),
      isLiving,
    });
    if (!v.ok) return setErrors(v.errors);
    const fields = Object.fromEntries(
      Object.entries(v.data).filter(([k]) => k !== 'version'),
    ) as Omit<typeof v.data, 'version'>;
    const consistency = personConsistencyErrors({ ...p, ...fields });
    if (Object.keys(consistency).length > 0) {
      return setErrors(Object.fromEntries(Object.entries(consistency).map(([k, m]) => [k, m[0]])));
    }
    setErrors({});
    if (await s.save(fields)) onClose();
  }

  const area = (k: 'biography' | 'notes', label: string) => (
    <div className="field">
      <label htmlFor={`info-${k}`}>{label}</label>
      <textarea
        id={`info-${k}`}
        rows={5}
        value={text[k]}
        onChange={(e) => set(k)(e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
      />
      {errors[k] && <p className="field-error">{errors[k]}</p>}
    </div>
  );
  const field = (k: keyof typeof text, label: string) => (
    <Field label={label} name={k} value={text[k]} onChange={set(k)} error={errors[k]} />
  );

  return (
    <form onSubmit={(e) => void submit(e)}>
      <FormError>{s.error}</FormError>
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
        <label htmlFor="info-sex">Sex</label>
        <select id="info-sex" value={sex} onChange={(e) => setSex(e.target.value)}>
          {SEXES.map((x) => (
            <option key={x} value={x}>
              {SEX_LABEL[x]}
            </option>
          ))}
        </select>
      </div>
      <FuzzyDateField label="Born" value={birth} onChange={setBirth} error={errors.birthDate} />
      <FuzzyDateField label="Died" value={death} onChange={setDeath} error={errors.deathDate} />
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={isLiving}
            onChange={(e) => setIsLiving(e.target.checked)}
            style={{ width: 'auto' }}
          />{' '}
          Living
        </label>
        {errors.isLiving && <p className="field-error">{errors.isLiving}</p>}
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
