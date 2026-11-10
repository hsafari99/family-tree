import { SEXES } from '@family-tree/shared';
import { useId } from 'react';
import { Field, type FieldErrors } from '../../components/forms';
import { SEX_LABEL } from '../../trees/format';

export interface QuickValues {
  givenName: string;
  surname: string;
  sex: string;
  birthYear: string;
}
export const emptyQuick = (surname = ''): QuickValues => ({
  givenName: '',
  surname,
  sex: 'unknown',
  birthYear: '',
});

/** The `person` part of a create request: blank optional fields are left out. */
export function quickPerson(v: QuickValues) {
  const surname = v.surname.trim();
  const year = v.birthYear.trim();
  return {
    givenName: v.givenName.trim(),
    ...(surname ? { surname } : {}),
    sex: v.sex,
    ...(year ? { birthDate: { qualifier: 'exact', date1: year } } : {}),
  };
}

export function QuickPersonFields({
  values,
  onChange,
  errors,
}: {
  values: QuickValues;
  onChange: (v: QuickValues) => void;
  errors: FieldErrors;
}) {
  const uid = useId();
  const set = (k: keyof QuickValues) => (value: string) => onChange({ ...values, [k]: value });
  return (
    <>
      <Field
        label="First name"
        name="givenName"
        value={values.givenName}
        onChange={set('givenName')}
        error={errors['person.givenName']}
      />
      <Field
        label="Last name"
        name="surname"
        value={values.surname}
        onChange={set('surname')}
        error={errors['person.surname']}
      />
      <div className="field">
        <label htmlFor={`${uid}-sex`}>Sex</label>
        <select id={`${uid}-sex`} value={values.sex} onChange={(e) => set('sex')(e.target.value)}>
          {SEXES.map((x) => (
            <option key={x} value={x}>
              {SEX_LABEL[x]}
            </option>
          ))}
        </select>
      </div>
      <Field
        label="Birth year"
        name="birthYear"
        inputMode="numeric"
        value={values.birthYear}
        onChange={set('birthYear')}
        error={errors['person.birthDate']}
      />
    </>
  );
}
