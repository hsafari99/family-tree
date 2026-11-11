import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ErrorSummary, errorAt, Field, serverFieldErrors } from './forms';

function Pw() {
  const [v, setV] = useState('');
  return <Field label="Password" name="password" type="password" value={v} onChange={setV} />;
}

describe('Field type=password', () => {
  it('has a Show password toggle button that reveals and hides the text', () => {
    render(<Pw />);
    const input = screen.getByLabelText('Password', { selector: 'input' });
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('aria-controls', input.id);
    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('is a plain button, so it never submits the form', () => {
    render(<Pw />);
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('type', 'button');
  });

  it('has no toggle on other inputs', () => {
    render(<Field label="Email" name="email" value="" onChange={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks the input with data-field for the error summary', () => {
    render(<Field label="Email" name="email" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('data-field', 'email');
  });
});

describe('errorAt', () => {
  it('finds the error for a key or a part under it', () => {
    expect(errorAt({ 'person.birthDate': 'a' }, 'person.birthDate')).toBe('a');
    expect(errorAt({ 'person.birthDate.date1': 'b' }, 'person.birthDate')).toBe('b');
    expect(errorAt({ 'person.birthDateX': 'c' }, 'person.birthDate')).toBeUndefined();
  });
});

describe('ErrorSummary', () => {
  it('lists errors, takes focus, and moves focus to the field', () => {
    render(
      <form>
        <ErrorSummary
          errors={{ givenName: 'Enter a first name', deathDate: 'Choose a month' }}
          labels={{ givenName: 'First name', deathDate: 'Died' }}
        />
        <Field
          label="First name"
          name="givenName"
          value=""
          onChange={() => {}}
          error="Enter a first name"
        />
        <input type="date" data-field="deathDate" aria-label="Date" />
      </form>,
    );
    const summary = screen.getByRole('alert');
    expect(summary).toHaveFocus();
    fireEvent.click(within(summary).getByRole('button', { name: 'Died: Choose a month' }));
    expect(screen.getByLabelText('Date')).toHaveFocus();
    fireEvent.click(
      within(summary).getByRole('button', { name: 'First name: Enter a first name' }),
    );
    expect(screen.getByLabelText('First name')).toHaveFocus();
  });

  it('shows an error with no label as plain text, and nothing when there are no errors', () => {
    const { rerender } = render(<ErrorSummary errors={{ '': 'Check the details' }} labels={{}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Check the details');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<ErrorSummary errors={{}} labels={{}} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('serverFieldErrors', () => {
  it('maps keys to a form field and fixed text, unknown keys to the summary only', () => {
    expect(
      serverFieldErrors(['isLiving', 'zzz'], {
        isLiving: { field: 'deathPlace', message: 'Tick “Mark as deceased” to add a death place' },
      }),
    ).toEqual({
      deathPlace: 'Tick “Mark as deceased” to add a death place',
      '': 'Check the details and try again',
    });
  });
});
