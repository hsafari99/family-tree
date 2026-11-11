import { SEXES } from '@family-tree/shared';
import { useId } from 'react';
import {
  draftError,
  type FuzzyDraft,
  FuzzyDateField,
  fromDraft,
  toDraft,
} from '../../components/FuzzyDateField';
import { errorAt, Field, type FieldErrors } from '../../components/forms';
import { SEX_LABEL } from '../../trees/format';

export interface QuickValues {
  givenName: string;
  surname: string;
  sex: string;
  birth: FuzzyDraft;
}
export const emptyQuick = (surname = ''): QuickValues => ({
  givenName: '',
  surname,
  sex: 'unknown',
  // Quick add is for an approximate birth year (spec §6), so it opens at year precision (#4).
  birth: { ...toDraft(null), precision: 'year' },
});

/** The `person` part of a create request: blank optional fields are left out. */
export function quickPerson(v: QuickValues) {
  const surname = v.surname.trim();
  const birthDate = fromDraft(v.birth);
  return {
    givenName: v.givenName.trim(),
    ...(surname ? { surname } : {}),
    sex: v.sex,
    ...(birthDate === null ? {} : { birthDate }),
  };
}

/** The error summary's names for the quick-add fields (#8). */
export const QUICK_LABELS: Record<string, string> = {
  'person.givenName': 'First name',
  'person.surname': 'Last name',
  'person.sex': 'Sex',
  'person.birthDate': 'Born',
};

/** Our own message for a half-typed birth date, keyed like the schema's errors (or {}). */
export function quickErrors(v: QuickValues, prefix = 'person'): FieldErrors {
  const message = draftError(v.birth);
  return message ? { [`${prefix}.birthDate`]: message } : {};
}

/** `prefix` is the request path of the person (`person`, or `coParent.person` for a second parent). */
export function QuickPersonFields({
  values,
  onChange,
  errors,
  prefix = 'person',
}: {
  values: QuickValues;
  onChange: (v: QuickValues) => void;
  errors: FieldErrors;
  prefix?: string;
}) {
  const uid = useId();
  const set = (k: Exclude<keyof QuickValues, 'birth'>) => (value: string) =>
    onChange({ ...values, [k]: value });
  return (
    <>
      <Field
        label="First name"
        name={`${prefix}.givenName`}
        value={values.givenName}
        onChange={set('givenName')}
        error={errors[`${prefix}.givenName`]}
      />
      <Field
        label="Last name"
        name={`${prefix}.surname`}
        value={values.surname}
        onChange={set('surname')}
        error={errors[`${prefix}.surname`]}
      />
      <div className="field">
        <label htmlFor={`${uid}-sex`}>Sex</label>
        <select
          id={`${uid}-sex`}
          data-field={`${prefix}.sex`}
          value={values.sex}
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
        name={`${prefix}.birthDate`}
        value={values.birth}
        onChange={(birth) => onChange({ ...values, birth })}
        error={errorAt(errors, `${prefix}.birthDate`)}
      />
    </>
  );
}
