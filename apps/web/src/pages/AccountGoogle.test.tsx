import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FAKE_TOTP, FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';

function account({
  twoFactorEnabled = false,
  googleConnected = false,
  hasPassword = true,
  google = true,
} = {}) {
  const api = new FakeAuthApi();
  api.providers = { google };
  const user = api.addUser(
    { email: 'ada@example.com', name: 'Ada', twoFactorEnabled, googleConnected, hasPassword },
    { signedIn: true },
  );
  return { api, user };
}

const section = () => screen.findByRole('region', { name: 'Google sign-in' });
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('Account settings: Google', () => {
  it('connects after the password is re-entered', async () => {
    const { api } = account();
    renderAt('/account/google', { auth: api });
    const google = await section();
    expect(within(google).getByText('Not connected')).toBeInTheDocument();
    expect(within(google).queryByLabelText('Authenticator or recovery code')).toBeNull();

    fireEvent.click(within(google).getByRole('button', { name: 'Connect Google' }));
    expect(await within(google).findByText('Enter your password')).toBeInTheDocument();
    expect(api.callsTo('connectGoogle')).toEqual([]);

    type('Your password, to connect Google', 'Correct-horse1');
    fireEvent.click(within(google).getByRole('button', { name: 'Connect Google' }));
    await waitFor(() =>
      expect(api.callsTo('connectGoogle')).toEqual([{ password: 'Correct-horse1' }]),
    );
    // The real API leaves for Google now.
    expect(within(google).getByRole('button', { name: 'Opening Google…' })).toBeDisabled();
  });

  it('also wants a code when two-step verification is on', async () => {
    const { api } = account({ twoFactorEnabled: true });
    renderAt('/account/google', { auth: api });
    const google = await section();
    type('Your password, to connect Google', 'Correct-horse1');
    fireEvent.click(within(google).getByRole('button', { name: 'Connect Google' }));
    expect(
      await within(google).findByText('Enter a 6-digit code or a recovery code'),
    ).toBeInTheDocument();
    expect(api.callsTo('connectGoogle')).toEqual([]);

    type('Authenticator or recovery code', '123 456');
    fireEvent.click(within(google).getByRole('button', { name: 'Connect Google' }));
    await waitFor(() =>
      expect(api.callsTo('connectGoogle')).toEqual([
        { password: 'Correct-horse1', code: FAKE_TOTP },
      ]),
    );
  });

  it('shows a refused re-authentication as a fixed message', async () => {
    const { api } = account();
    renderAt('/account/google', { auth: api });
    const google = await section();
    type('Your password, to connect Google', 'wrong-password');
    fireEvent.click(within(google).getByRole('button', { name: 'Connect Google' }));
    expect(await within(google).findByRole('alert')).toHaveTextContent(MESSAGES.badPassword);
    expect(within(google).getByRole('button', { name: 'Connect Google' })).toBeEnabled();
  });

  it('confirms a connection when Google sends the user back', async () => {
    renderAt('/account/google?google=connected', { auth: account({ googleConnected: true }).api });
    const google = await section();
    expect(within(google).getByRole('status')).toHaveTextContent('Google is connected');
    expect(within(google).getByText('Connected')).toBeInTheDocument();
  });

  it.each([
    ['account_already_linked_to_different_user', MESSAGES.googleLinkedElsewhere],
    ['email_doesn%27t_match', MESSAGES.googleConnectFailed],
    ['%3Cscript%3E', MESSAGES.googleConnectFailed],
  ])('maps the callback error %s to a fixed message', async (code, message) => {
    renderAt(`/account/google?error=${code}`, { auth: account().api });
    expect(await within(await section()).findByRole('alert')).toHaveTextContent(message);
  });

  it('disconnects in two steps after the password is re-entered', async () => {
    const { api, user } = account({ googleConnected: true });
    renderAt('/account/google', { auth: api });
    const google = await section();
    expect(within(google).queryByLabelText('Authenticator or recovery code')).toBeNull();
    fireEvent.click(within(google).getByRole('button', { name: 'Disconnect Google' }));
    fireEvent.click(within(google).getByRole('button', { name: 'Yes, disconnect' }));
    expect(await within(google).findByText('Enter your password')).toBeInTheDocument();
    expect(api.callsTo('disconnectGoogle')).toEqual([]);

    type('Your password, to disconnect Google', 'wrong-password');
    fireEvent.click(within(google).getByRole('button', { name: 'Disconnect Google' }));
    fireEvent.click(within(google).getByRole('button', { name: 'Yes, disconnect' }));
    expect(await within(google).findByRole('alert')).toHaveTextContent(MESSAGES.badPassword);
    expect(user.googleConnected).toBe(true);

    type('Your password, to disconnect Google', 'Correct-horse1');
    fireEvent.click(within(google).getByRole('button', { name: 'Disconnect Google' }));
    fireEvent.click(within(google).getByRole('button', { name: 'Yes, disconnect' }));
    expect(await within(google).findByRole('status')).toHaveTextContent('Google disconnected');
    expect(user.googleConnected).toBe(false);
    expect(within(google).getByText('Not connected')).toBeInTheDocument();
    expect(within(google).getByRole('heading', { name: 'Google sign-in' })).toHaveFocus();
  });

  it('also wants a code to disconnect when two-step verification is on', async () => {
    const { api } = account({ googleConnected: true, twoFactorEnabled: true });
    renderAt('/account/google', { auth: api });
    const google = await section();
    type('Your password, to disconnect Google', 'Correct-horse1');
    type('Authenticator or recovery code', FAKE_TOTP);
    fireEvent.click(within(google).getByRole('button', { name: 'Disconnect Google' }));
    fireEvent.click(within(google).getByRole('button', { name: 'Yes, disconnect' }));
    await waitFor(() =>
      expect(api.callsTo('disconnectGoogle')).toEqual([
        { password: 'Correct-horse1', code: FAKE_TOTP },
      ]),
    );
  });

  it('offers no disconnect when Google is the only way in; a password unlocks it', async () => {
    const { api, user } = account({ googleConnected: true, hasPassword: false });
    renderAt('/account/google', { auth: api });
    const google = await section();
    expect(within(google).queryByRole('button', { name: 'Disconnect Google' })).toBeNull();
    expect(within(google).getByText(/only way to sign in/)).toBeInTheDocument();

    // Everything else that needs a password waits for one.
    fireEvent.click(screen.getByRole('link', { name: 'Two-step verification' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Two-step verification' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on two-step verification' })).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Account settings' });
    expect(within(nav).getByRole('link', { name: 'Set a password' })).toHaveAttribute(
      'href',
      '/account/password',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Delete account' }));
    expect(await screen.findByText(/Set a password first/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete my account' })).toBeNull();

    fireEvent.click(within(nav).getByRole('link', { name: 'Set a password' }));
    const setPassword = await screen.findByRole('region', { name: 'Set a password' });
    expect(screen.queryByRole('heading', { name: 'Change password' })).toBeNull();
    fireEvent.click(within(setPassword).getByRole('button', { name: 'Set password' }));
    expect(await within(setPassword).findByText('Use at least 10 characters')).toBeInTheDocument();
    type('New password', 'A brand new password1');
    fireEvent.click(within(setPassword).getByRole('button', { name: 'Set password' }));

    expect(await screen.findByRole('heading', { name: 'Change password' })).toBeInTheDocument();
    expect(
      screen.getByText('Password set. You can now sign in with your email too.'),
    ).toBeVisible();
    expect(user.hasPassword).toBe(true);
    expect(within(nav).getByRole('link', { name: 'Change password' })).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('link', { name: 'Google sign-in' }));
    expect(
      within(await section()).getByRole('button', { name: 'Disconnect Google' }),
    ).toBeInTheDocument();
  });

  it('sends a stale sign-in back through Google before setting a password', async () => {
    const { api, user } = account({ googleConnected: true, hasPassword: false });
    api.recentSignIn = false;
    renderAt('/account/password', { auth: api });
    const setPassword = await screen.findByRole('region', { name: 'Set a password' });
    type('New password', 'A brand new password1');
    fireEvent.click(within(setPassword).getByRole('button', { name: 'Set password' }));
    expect(await within(setPassword).findByRole('alert')).toHaveTextContent(
      MESSAGES.recentSignInRequired,
    );
    expect(user.hasPassword).toBe(false);
    fireEvent.click(within(setPassword).getByRole('button', { name: 'Sign in with Google again' }));
    await waitFor(() =>
      expect(api.callsTo('startGoogleSignIn')).toEqual([{ next: '/account/password' }]),
    );
  });

  it('is hidden while Google sign-in is off and not connected', async () => {
    const { api } = account({ google: false });
    renderAt('/account', { auth: api });
    const nav = await screen.findByRole('navigation', { name: 'Account settings' });
    await waitFor(() => expect(api.callsTo('getProviders')).toHaveLength(1));
    expect(within(nav).queryByRole('link', { name: 'Google sign-in' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Google sign-in' })).toBeNull();
  });

  it('lists Google sign-in in the nav when it is on', async () => {
    renderAt('/account', { auth: account({ googleConnected: true }).api });
    const nav = await screen.findByRole('navigation', { name: 'Account settings' });
    expect(await within(nav).findByRole('link', { name: 'Google sign-in' })).toHaveAttribute(
      'href',
      '/account/google',
    );
  });
});

describe('Start a new tree without a password', () => {
  it('sends a Google-only account to set a password first', async () => {
    const { api } = account({ googleConnected: true, hasPassword: false });
    renderAt('/trees/new', { auth: api });
    expect(await screen.findByRole('link', { name: 'Set a password' })).toHaveAttribute(
      'href',
      '/account/password',
    );
    expect(screen.queryByRole('button', { name: 'Turn on two-step verification' })).toBeNull();
  });
});
