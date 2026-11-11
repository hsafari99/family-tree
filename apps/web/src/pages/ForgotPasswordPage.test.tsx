import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FAKE_TOTP, FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';

function seeded() {
  const api = new FakeAuthApi();
  api.addUser({ email: 'ada@example.com', twoFactorEnabled: true });
  return api;
}

function submit(email: string, code: string, newPassword: string, repeat = newPassword) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Authenticator or recovery code'), {
    target: { value: code },
  });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: newPassword } });
  fireEvent.change(screen.getByLabelText('Repeat new password'), { target: { value: repeat } });
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
}

describe('ForgotPasswordPage', () => {
  it('explains the reset-link alternative', async () => {
    renderAt('/forgot-password');
    expect(
      await screen.findByText('No authenticator? Ask your tree owner for a reset link.'),
    ).toBeInTheDocument();
  });

  it('validates every field before calling the API', async () => {
    const { api } = renderAt('/forgot-password', { auth: seeded() });
    await screen.findByLabelText('Email');
    submit('nope', 'abc', 'short');
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter a 6-digit code or a recovery code')).toBeInTheDocument();
    expect(screen.getByText('Use at least 10 characters')).toBeInTheDocument();
    expect(api.callsTo('resetWithCode')).toHaveLength(0);
  });

  it('shows the generic error for a wrong code', async () => {
    renderAt('/forgot-password', { auth: seeded() });
    await screen.findByLabelText('Email');
    submit('ada@example.com', '000000', 'brand-new-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or code is incorrect');
  });

  it('changes the password and links to sign in', async () => {
    const api = seeded();
    renderAt('/forgot-password', { auth: api });
    await screen.findByLabelText('Email');
    submit('ada@example.com', FAKE_TOTP, 'brand-new-password');
    expect(
      await screen.findByText('Password changed — sign in with your new password'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(api.users.get('ada@example.com')!.password).toBe('brand-new-password');
  });

  it('checks the repeat matches without calling the API', async () => {
    const { api } = renderAt('/forgot-password', { auth: seeded() });
    await screen.findByLabelText('Email');
    submit('ada@example.com', FAKE_TOTP, 'brand-new-password', 'brand-new-passw0rd');
    expect(await screen.findByText('The passwords don’t match')).toBeInTheDocument();
    expect(screen.getByLabelText('Repeat new password')).toHaveAccessibleDescription(
      'The passwords don’t match',
    );
    expect(api.callsTo('resetWithCode')).toHaveLength(0);
  });
});
