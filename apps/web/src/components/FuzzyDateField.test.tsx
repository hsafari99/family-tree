import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  draftError,
  type FuzzyDraft,
  FuzzyDateField,
  fromDraft,
  toDraft,
  withPrecision,
} from './FuzzyDateField';

function Harness({ initial = toDraft(null), error }: { initial?: FuzzyDraft; error?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <FuzzyDateField
        label="Died"
        name="deathDate"
        value={value}
        onChange={setValue}
        error={error}
      />
      <output data-testid="value">{JSON.stringify(fromDraft(value))}</output>
    </>
  );
}
const value = () => JSON.parse(screen.getByTestId('value').textContent!);

describe('FuzzyDateField', () => {
  it('defaults to an exact day with a native calendar', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Precision')).toHaveValue('day');
    const date = screen.getByLabelText('Date');
    expect(date).toHaveAttribute('type', 'date');
    fireEvent.change(date, { target: { value: '1950-03-07' } });
    expect(value()).toEqual({ qualifier: 'exact', date1: '1950-03-07' });
  });

  it('lists the certainty choices', () => {
    render(<Harness />);
    const select = screen.getByLabelText('How certain') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual([
      'Exact',
      'About',
      'Before',
      'After',
      'Between',
    ]);
  });

  it('month precision: a year input and a month select', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Precision'), { target: { value: 'month' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '1950' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '03' } });
    expect(value()).toEqual({ qualifier: 'exact', date1: '1950-03' });
  });

  it('year precision with about', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Precision'), { target: { value: 'year' } });
    fireEvent.change(screen.getByLabelText('How certain'), { target: { value: 'about' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '1950' } });
    expect(value()).toEqual({ qualifier: 'about', date1: '1950' });
  });

  it('between shows two controls of the same precision', () => {
    render(<Harness />);
    expect(screen.queryByLabelText('To')).toBeNull();
    fireEvent.change(screen.getByLabelText('How certain'), { target: { value: 'between' } });
    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('To')).toHaveAttribute('type', 'date');
    fireEvent.change(screen.getByLabelText('Precision'), { target: { value: 'year' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '1950' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '1955' } });
    expect(value()).toEqual({ qualifier: 'between', date1: '1950', date2: '1955' });
  });

  it('opens a stored month date at month precision', () => {
    render(<Harness initial={toDraft({ qualifier: 'before', date1: '1950-03' })} />);
    expect(screen.getByLabelText('Precision')).toHaveValue('month');
    expect(screen.getByLabelText('Year')).toHaveValue('1950');
    expect(screen.getByLabelText('Month')).toHaveValue('03');
  });

  it('ties the error to the group and marks the first date control for the summary', () => {
    render(<Harness error="Choose a month" />);
    const group = screen.getByRole('group', { name: 'Died' });
    expect(group).toHaveAccessibleDescription(/Choose a month/);
    expect(screen.getByLabelText('Precision')).not.toHaveAttribute('data-field');
    expect(screen.getByLabelText('Date')).toHaveAttribute('data-field', 'deathDate');
    fireEvent.change(screen.getByLabelText('Precision'), { target: { value: 'month' } });
    expect(screen.getByLabelText('Year')).toHaveAttribute('data-field', 'deathDate');
    expect(screen.getByLabelText('Month')).not.toHaveAttribute('data-field');
    fireEvent.change(screen.getByLabelText('How certain'), { target: { value: 'between' } });
    expect(document.querySelectorAll('[data-field="deathDate"]')).toHaveLength(1);
  });

  it('a half-typed calendar date blocks the save instead of clearing the date', () => {
    function Probe() {
      const [v, setV] = useState(toDraft({ qualifier: 'exact', date1: '1950-03-07' }));
      return (
        <>
          <FuzzyDateField label="Born" name="birthDate" value={v} onChange={setV} />
          <output data-testid="error">{draftError(v) ?? ''}</output>
        </>
      );
    }
    render(<Probe />);
    const date = screen.getByLabelText('Date') as HTMLInputElement;
    // The browser reports '' with validity.badInput while a part of the date is missing.
    Object.defineProperty(date, 'validity', { value: { badInput: true } });
    fireEvent.change(date, { target: { value: '' } });
    expect(screen.getByTestId('error')).toHaveTextContent('Pick a date');
    expect(date).toHaveValue('');
    // Going coarser keeps nothing of a half-typed date.
    fireEvent.change(screen.getByLabelText('Precision'), { target: { value: 'year' } });
    expect(screen.getByLabelText('Year')).toHaveValue('');
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });
});

describe('draft helpers', () => {
  it('withPrecision keeps what fits', () => {
    const d: FuzzyDraft = { qualifier: 'exact', precision: 'day', date1: '1950-03-07', date2: '' };
    expect(withPrecision(d, 'month').date1).toBe('1950-03');
    expect(withPrecision(withPrecision(d, 'month'), 'year').date1).toBe('1950');
    expect(withPrecision(withPrecision(d, 'year'), 'month').date1).toBe('1950-');
    expect(withPrecision(withPrecision(d, 'year'), 'day').date1).toBe('');
  });
  it('draftError gives plain messages', () => {
    const base = { qualifier: 'exact', date2: '' } as const;
    expect(draftError({ ...base, precision: 'year', date1: '' })).toBeNull();
    expect(draftError({ ...base, precision: 'year', date1: '19' })).toBe(
      'Enter a 4-digit year, like 1950',
    );
    expect(draftError({ ...base, precision: 'month', date1: '1950-' })).toBe('Choose a month');
    expect(draftError({ ...base, precision: 'month', date1: '-03' })).toBe(
      'Enter a 4-digit year, like 1950',
    );
    expect(
      draftError({ ...base, qualifier: 'between', precision: 'year', date1: '1950', date2: '' }),
    ).toBe('Enter the second date');
  });
  it('opens a mixed-precision range at the coarser precision, so it saves unchanged', () => {
    const d = toDraft({ qualifier: 'between', date1: '1950-06', date2: '1950' });
    expect(d).toEqual({ qualifier: 'between', precision: 'year', date1: '1950', date2: '1950' });
    expect(draftError(d)).toBeNull();
    const e = toDraft({ qualifier: 'between', date1: '1950-06-15', date2: '1950-06' });
    expect(e).toMatchObject({ precision: 'month', date1: '1950-06', date2: '1950-06' });
    expect(draftError(e)).toBeNull();
  });
  it('fromDraft is null for an empty date', () => {
    expect(fromDraft(toDraft(null))).toBeNull();
  });
});
