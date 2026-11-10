import { DATE_QUALIFIERS, type DateQualifier, type FuzzyDate } from '@family-tree/shared';
import { useId } from 'react';
import { QUALIFIER_LABEL } from '../trees/format';

export interface FuzzyDraft {
  qualifier: DateQualifier;
  date1: string;
  date2: string;
}

export const toDraft = (d: FuzzyDate | null): FuzzyDraft =>
  d
    ? { qualifier: d.qualifier, date1: d.date1, date2: d.date2 ?? '' }
    : { qualifier: 'exact', date1: '', date2: '' };

/** The value to validate with fuzzyDateSchema: null when no date is typed. */
export function fromDraft(d: FuzzyDraft): unknown {
  const date1 = d.date1.trim();
  if (date1 === '') return null;
  return d.qualifier === 'between'
    ? { qualifier: d.qualifier, date1, date2: d.date2.trim() }
    : { qualifier: d.qualifier, date1 };
}

export function FuzzyDateField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: FuzzyDraft;
  onChange: (v: FuzzyDraft) => void;
  error?: string | undefined;
}) {
  const id = useId();
  const describedBy = error ? `${id}-hint ${id}-error` : `${id}-hint`;
  const between = value.qualifier === 'between';
  return (
    <fieldset className="field fuzzy-date" aria-describedby={error ? `${id}-error` : `${id}-hint`}>
      <legend>{label}</legend>
      <p id={`${id}-hint`} className="hint">
        Year, year and month, or full date: 1950, 1950-03 or 1950-03-07
      </p>
      <label htmlFor={`${id}-q`}>How certain</label>
      <select
        id={`${id}-q`}
        value={value.qualifier}
        onChange={(e) => onChange({ ...value, qualifier: e.target.value as DateQualifier })}
      >
        {DATE_QUALIFIERS.map((q) => (
          <option key={q} value={q}>
            {QUALIFIER_LABEL[q]}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-1`}>{between ? 'From' : 'Date'}</label>
      <input
        id={`${id}-1`}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        inputMode="numeric"
        value={value.date1}
        onChange={(e) => onChange({ ...value, date1: e.target.value })}
      />
      {between && (
        <>
          <label htmlFor={`${id}-2`}>and</label>
          <input
            id={`${id}-2`}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            inputMode="numeric"
            value={value.date2}
            onChange={(e) => onChange({ ...value, date2: e.target.value })}
          />
        </>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
