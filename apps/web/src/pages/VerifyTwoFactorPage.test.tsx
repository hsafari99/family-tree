import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FAKE_TOTP, FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';

/** A user who has passed the password step and now needs a second factor. */
function challenged() {
  const api = new FakeAuthApi();
  const user = api.addUser({ email: 'ada@example.com', name: 'Ada', twoFactorEnabled: true });
  api.challenge = user.email;
  return { api, user };
}

function submit(label: string, code: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('VerifyTwoFactorPage', () => {
  it('accepts a valid code and goes on to next', async () => {
    const { api } = challenged();
    renderAt('/sign-in/verify?next=%2Faccount', api);
    const input = await screen.findByLabelText('6-digit code');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    submit('6-digit code', '123 456');
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(api.callsTo('verifyTotp')).toEqual([{ code: FAKE_TOTP, trustDevice: false }]);
  });

  it('shows an invalid code', async () => {
    renderAt('/sign-in/verify', challenged().api);
    await screen.findByLabelText('6-digit code');
    submit('6-digit code', '000000');
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.badCode);
  });

  it('validates the code format before calling the API', async () => {
    const { api } = challenged();
    renderAt('/sign-in/verify', api);
    await screen.findByLabelText('6-digit code');
    submit('6-digit code', '12');
    expect(await screen.findByText('Enter the 6-digit code')).toBeInTheDocument();
    expect(api.callsTo('verifyTotp')).toHaveLength(0);
  });

  it('switches to a recovery code, with its own schema and API method', async () => {
    const { api, user } = challenged();
    renderAt('/sign-in/verify', api);
    fireEvent.click(await screen.findByRole('button', { name: 'Use a recovery code instead' }));
    expect(screen.getByLabelText('Recovery code')).toHaveAttribute('autocomplete', 'off');
    submit('Recovery code', '123456');
    expect(await screen.findByText('Enter a recovery code like abcde-12345')).toBeInTheDocument();
    expect(api.callsTo('verifyRecoveryCode')).toHaveLength(0);

    const code = user.recoveryCodes[0]!;
    submit('Recovery code', code);
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
    expect(api.callsTo('verifyRecoveryCode')).toEqual([{ code }]);
    expect(api.callsTo('verifyTotp')).toHaveLength(0);
  });

  it('asks the user to sign in again after too many attempts', async () => {
    const { api } = challenged();
    api.failNext('verifyTotp', {
      code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
      message: MESSAGES.newChallenge,
    });
    renderAt('/sign-in/verify', api);
    await screen.findByLabelText('6-digit code');
    submit('6-digit code', '111111');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(MESSAGES.newChallenge);
    expect(screen.getByRole('link', { name: 'Sign in again' })).toBeInTheDocument();
  });

  it('explains the lockout', async () => {
    const { api } = challenged();
    api.failNext('verifyTotp', { code: 'ACCOUNT_TEMPORARILY_LOCKED', message: MESSAGES.locked });
    renderAt('/sign-in/verify', api);
    await screen.findByLabelText('6-digit code');
    submit('6-digit code', '111111');
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.locked);
  });
});
