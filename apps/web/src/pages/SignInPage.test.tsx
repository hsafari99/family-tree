import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';

function seeded({ twoFactorEnabled = false } = {}) {
  const api = new FakeAuthApi();
  api.addUser({ email: 'ada@example.com', name: 'Ada', twoFactorEnabled });
  return api;
}

function signIn(password = 'Correct-horse1') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('SignInPage', () => {
  it('links to the forgot-password page', async () => {
    renderAt('/sign-in');
    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('validates before calling the API', async () => {
    const { api } = renderAt('/sign-in');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(api.callsTo('signIn')).toHaveLength(0);
  });

  it('shows a wrong password', async () => {
    renderAt('/sign-in', { auth: seeded() });
    signIn('wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('goes to the verify page when a second factor is required', async () => {
    renderAt('/sign-in?next=%2Faccount', { auth: seeded({ twoFactorEnabled: true }) });
    signIn();
    expect(await screen.findByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  });

  it('goes to the next path after signing in', async () => {
    renderAt('/sign-in?next=%2Faccount', { auth: seeded() });
    signIn();
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  it('goes home when there is no next path', async () => {
    renderAt('/sign-in', { auth: seeded() });
    signIn();
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
  });

  it('ignores an off-site next value', async () => {
    renderAt('/sign-in?next=https%3A%2F%2Fevil.example', { auth: seeded() });
    signIn();
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
  });

  it('ignores a protocol-relative next value', async () => {
    renderAt('/sign-in?next=%2F%2Fevil.example', { auth: seeded() });
    signIn();
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
  });

  it('sends an already signed-in user on to next', async () => {
    const api = seeded();
    api.current = 'ada@example.com';
    renderAt('/sign-in?next=%2Faccount', { auth: api });
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  it('keeps next on the link to the other page', async () => {
    renderAt('/sign-in?next=%2Finvite%2Fabc');
    expect(await screen.findByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      expect.stringContaining('next=%2Finvite%2Fabc'),
    );
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toMatch(
      /^\/sign-up/,
    );
  });
});
