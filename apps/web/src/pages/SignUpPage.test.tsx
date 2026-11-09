import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';

function fill(name: string, email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('SignUpPage', () => {
  it('rejects a short password without calling the API', async () => {
    const { api } = renderAt('/sign-up');
    await screen.findByRole('heading', { name: 'Create an account' });
    fill('Ada', 'ada@example.com', 'short');
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('signUp')).toHaveLength(0);
  });

  it('signs up and lands on the home page signed in', async () => {
    const { api } = renderAt('/sign-up');
    fill('Ada', ' Ada@Example.com ', 'correct-horse-battery');
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
    expect(api.callsTo('signUp')).toEqual([
      { name: 'Ada', email: 'ada@example.com', password: 'correct-horse-battery' },
    ]);
  });

  it('shows a server error in the alert region', async () => {
    const api = new FakeAuthApi();
    api.addUser({ email: 'ada@example.com' });
    renderAt('/sign-up', { auth: api });
    fill('Ada', 'ada@example.com', 'correct-horse-battery');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists',
    );
  });

  it('disables the submit button while pending', async () => {
    const api = new FakeAuthApi();
    api.hold('signUp');
    renderAt('/sign-up', { auth: api });
    fill('Ada', 'ada@example.com', 'correct-horse-battery');
    expect(await screen.findByRole('button', { name: 'Creating account…' })).toBeDisabled();
    api.release();
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
  });

  it('uses autocomplete hints', async () => {
    renderAt('/sign-up');
    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('sends an already signed-in user home', async () => {
    const api = new FakeAuthApi();
    api.addUser({ email: 'ada@example.com', name: 'Ada' }, { signedIn: true });
    renderAt('/sign-up', { auth: api });
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
  });
});
