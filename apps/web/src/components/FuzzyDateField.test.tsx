import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { type FuzzyDraft, FuzzyDateField, fromDraft, toDraft } from './FuzzyDateField';

function Harness({ error }: { error?: string }) {
  const [value, setValue] = useState<FuzzyDraft>(toDraft(null));
  return <FuzzyDateField label="Birth date" value={value} onChange={setValue} error={error} />;
}

describe('FuzzyDateField', () => {
  it('renders a labelled group with a certainty select and a date input', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Birth date' });
    expect(group).toBeInTheDocument();
    const select = screen.getByLabelText('How certain');
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'Exact',
      'About',
      'Before',
      'After',
      'Between',
    ]);
    expect(screen.getByLabelText('Date')).toBeInTheDocument();
  });

  it('shows a second input for Between', () => {
    render(<Harness />);
    expect(screen.queryByLabelText('and')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('How certain'), { target: { value: 'between' } });
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('and')).toBeInTheDocument();
  });

  it('shows the error and links it with aria-describedby', () => {
    render(<Harness error="Enter a real date" />);
    const group = screen.getByRole('group', { name: 'Birth date' });
    const error = screen.getByText('Enter a real date');
    expect(group.getAttribute('aria-describedby')).toBe(error.id);
  });
});

describe('fromDraft', () => {
  it('gives null for a blank date', () => {
    expect(fromDraft({ qualifier: 'exact', date1: '  ', date2: '' })).toBeNull();
  });
  it('keeps between as is', () => {
    expect(fromDraft({ qualifier: 'between', date1: '1950', date2: '1955' })).toEqual({
      qualifier: 'between',
      date1: '1950',
      date2: '1955',
    });
  });
  it('drops date2 for other qualifiers', () => {
    expect(fromDraft({ qualifier: 'exact', date1: '1950', date2: '1955' })).toEqual({
      qualifier: 'exact',
      date1: '1950',
    });
  });
});
