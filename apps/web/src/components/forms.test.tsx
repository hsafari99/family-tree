import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Field } from './forms';

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
