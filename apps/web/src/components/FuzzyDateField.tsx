import {
  DATE_PRECISIONS,
  DATE_QUALIFIERS,
  type DatePrecision,
  type DateQualifier,
  type FuzzyDate,
  precisionOf,
} from '@family-tree/shared';
import { useId } from 'react';
import { QUALIFIER_LABEL } from '../trees/format';

export interface FuzzyDraft {
  qualifier: DateQualifier;
  precision: DatePrecision;
  /** day: YYYY-MM-DD; month: "YYYY-MM" (either part may be blank while typing); year: YYYY. */
  date1: string;
  date2: string;
}

const PRECISION_LABEL: Record<DatePrecision, string> = {
  day: 'Exact day',
  month: 'Month and year',
  year: 'Year only',
};
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const toDraft = (d: FuzzyDate | null): FuzzyDraft =>
  d
    ? {
        qualifier: d.qualifier,
        precision: precisionOf(d.date1),
        date1: d.date1,
        date2: d.date2 ?? '',
      }
    : { qualifier: 'exact', precision: 'day', date1: '', date2: '' };

const cut = (s: string, p: DatePrecision) =>
  p === 'year' ? s.slice(0, 4) : p === 'month' ? s.slice(0, 7) : s;

/** Changes precision, keeping what fits: day -> month -> year cut; year -> month keeps the year. */
export function withPrecision(d: FuzzyDraft, precision: DatePrecision): FuzzyDraft {
  const fit = (s: string) => {
    // Going finer can't invent a day: the calendar starts empty.
    if (precision === 'day') return s.length === 10 ? s : '';
    const kept = cut(s, precision);
    // Year -> month keeps the year and leaves the month to choose.
    if (precision === 'month' && /^\d{4}$/.test(kept)) return `${kept}-`;
    return kept;
  };
  return { ...d, precision, date1: fit(d.date1), date2: fit(d.date2) };
}

const blank = (s: string) => s.replace(/-/g, '').trim() === '';

function partError(s: string, p: DatePrecision): string | null {
  if (p === 'day') return /^\d{4}-\d{2}-\d{2}$/.test(s) ? null : 'Pick a date';
  const [y = '', m = ''] = s.split('-');
  if (!/^\d{4}$/.test(y)) return 'Enter a 4-digit year, like 1950';
  if (p === 'month' && !/^\d{2}$/.test(m)) return 'Choose a month';
  return null;
}

/** Our own message for an incomplete draft, or null (the schema then checks real dates). */
export function draftError(d: FuzzyDraft): string | null {
  if (blank(d.date1)) return null;
  const first = partError(d.date1, d.precision);
  if (first) return first;
  if (d.qualifier !== 'between') return null;
  if (blank(d.date2)) return 'Enter the second date';
  return partError(d.date2, d.precision);
}

/** `draftError` for several drafts, keyed by their form field ({} when all are fine). */
export function draftErrors(drafts: Record<string, FuzzyDraft>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, d] of Object.entries(drafts)) {
    const message = draftError(d);
    if (message) out[key] = message;
  }
  return out;
}

/** The value to validate with fuzzyDateSchema: null when no date is typed. */
export function fromDraft(d: FuzzyDraft): unknown {
  if (blank(d.date1)) return null;
  return d.qualifier === 'between'
    ? { qualifier: d.qualifier, date1: d.date1, date2: d.date2 }
    : { qualifier: d.qualifier, date1: d.date1 };
}

function DateControl({
  id,
  label,
  precision,
  value,
  onChange,
  describedBy,
  invalid,
}: {
  id: string;
  label: 'Date' | 'From' | 'To';
  precision: DatePrecision;
  value: string;
  onChange: (v: string) => void;
  describedBy: string | undefined;
  invalid: boolean;
}) {
  const common = { 'aria-describedby': describedBy, 'aria-invalid': invalid || undefined };
  if (precision === 'day') {
    return (
      <span>
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...common}
        />
      </span>
    );
  }
  const [y = '', m = ''] = value.split('-');
  const join = (yy: string, mm: string) =>
    precision === 'year' ? yy : yy === '' && mm === '' ? '' : `${yy}-${mm}`;
  const year = (yearLabel: string) => (
    <span>
      <label htmlFor={`${id}-y`}>{yearLabel}</label>
      <input
        id={`${id}-y`}
        inputMode="numeric"
        maxLength={4}
        value={y}
        onChange={(e) => onChange(join(e.target.value.trim(), m))}
        {...common}
      />
    </span>
  );
  // One year input: it is the "Year" (or "From"/"To" in a range), so its label says so.
  if (precision === 'year') return year(label === 'Date' ? 'Year' : label);
  return (
    <div className="date-parts" role="group" aria-label={label}>
      {year('Year')}
      <span>
        <label htmlFor={`${id}-m`}>Month</label>
        <select
          id={`${id}-m`}
          value={m}
          onChange={(e) => onChange(join(y, e.target.value))}
          {...common}
        >
          <option value="">Month…</option>
          {MONTHS.map((name, i) => (
            <option key={name} value={String(i + 1).padStart(2, '0')}>
              {name}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

/** A fuzzy date: precision (calendar by default), certainty, then one or two dates (#4). */
export function FuzzyDateField({
  label,
  name,
  value,
  onChange,
  error,
}: {
  label: string;
  /** The form field key (birthDate, …): the error summary focuses it. */
  name: string;
  value: FuzzyDraft;
  onChange: (v: FuzzyDraft) => void;
  error?: string | undefined;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : undefined;
  const between = value.qualifier === 'between';
  return (
    <fieldset className="field fuzzy-date" aria-describedby={describedBy}>
      <legend>{label}</legend>
      <div className="date-row">
        <span>
          <label htmlFor={`${id}-p`}>Precision</label>
          <select
            id={`${id}-p`}
            data-field={name}
            value={value.precision}
            onChange={(e) => onChange(withPrecision(value, e.target.value as DatePrecision))}
          >
            {DATE_PRECISIONS.map((p) => (
              <option key={p} value={p}>
                {PRECISION_LABEL[p]}
              </option>
            ))}
          </select>
        </span>
        <span>
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
        </span>
      </div>
      <div className="date-row">
        <DateControl
          id={`${id}-1`}
          label={between ? 'From' : 'Date'}
          precision={value.precision}
          value={value.date1}
          onChange={(date1) => onChange({ ...value, date1 })}
          describedBy={describedBy}
          invalid={!!error}
        />
        {between && (
          <DateControl
            id={`${id}-2`}
            label="To"
            precision={value.precision}
            value={value.date2}
            onChange={(date2) => onChange({ ...value, date2 })}
            describedBy={describedBy}
            invalid={!!error}
          />
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
