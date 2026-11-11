import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FAKE_NEW_SECRET, FAKE_NEW_TOTP, FAKE_TOTP, FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';

afterEach(() => {
  vi.restoreAllMocks();
});

function account({ twoFactorEnabled = true, hasPassword = true, googleConnected = false } = {}) {
  const api = new FakeAuthApi();
  const user = api.addUser(
    { email: 'ada@example.com', name: 'Ada', twoFactorEnabled, hasPassword, googleConnected },
    { signedIn: true },
  );
  return { api, user };
}

const section = () => screen.findByRole('region', { name: 'Move to a new phone' });
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const stepHeading = (step: RegExp) => screen.findByRole('heading', { name: step });
/**
 * Waits for the heading to appear and then to take focus. Focus moves in an effect, and a step
 * reached after an API call renders outside act(), so the heading can be in the DOM a moment
 * before the effect has focused it.
 */
async function expectFocused(heading: HTMLElement | Promise<HTMLElement>) {
  const el = await heading;
  await waitFor(() => expect(el).toHaveFocus());
}

async function startMove(api: FakeAuthApi, code = FAKE_TOTP) {
  renderAt('/account', { auth: api });
  const region = await section();
  fireEvent.click(within(region).getByRole('button', { name: 'Move to a new phone' }));
  await expectFocused(stepHeading(/Step 1 of 3/));
  type('Your password', 'Correct-horse1');
  type('Code from your current phone, or a recovery code', code);
  click('Continue');
  return region;
}

describe('Account settings: move two-step verification to a new phone', () => {
  it('is only offered while two-step verification is on', async () => {
    renderAt('/account', { auth: account({ twoFactorEnabled: false }).api });
    await screen.findByRole('heading', { name: 'Account' });
    expect(screen.queryByRole('region', { name: 'Move to a new phone' })).toBeNull();
  });

  it('walks through confirm, scan and recovery codes, moving focus to each step', async () => {
    const alert = vi.spyOn(window, 'alert');
    const confirm = vi.spyOn(window, 'confirm');
    const { api } = account();
    const region = await startMove(api);

    await expectFocused(stepHeading(/Step 2 of 3/));
    expect(api.callsTo('startTwoFactorMove')).toEqual([
      { password: 'Correct-horse1', code: FAKE_TOTP },
    ]);
    expect(within(region).getByText(FAKE_NEW_SECRET)).toBeInTheDocument();
    type('6-digit code from the new phone', '654 321');
    click('Move to this phone');

    await expectFocused(stepHeading(/Step 3 of 3/));
    expect(api.callsTo('confirmTwoFactorMove')).toEqual([{ code: FAKE_NEW_TOTP }]);
    const codes = within(region).getByRole('list', { name: 'Recovery codes' });
    expect(within(codes).getAllByRole('listitem')).toHaveLength(8);
    click("I've saved these codes");

    expect(await within(region).findByRole('status')).toHaveTextContent(
      'Two-step verification now uses your new phone',
    );
    await expectFocused(screen.getByRole('heading', { name: 'Move to a new phone' }));
    expect(within(region).queryByRole('list', { name: 'Recovery codes' })).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('accepts a recovery code when the old phone is lost', async () => {
    const { api, user } = account();
    const recovery = user.recoveryCodes[0]!;
    await startMove(api, recovery);
    expect(await stepHeading(/Step 2 of 3/)).toBeInTheDocument();
    expect(api.callsTo('startTwoFactorMove')).toEqual([
      { password: 'Correct-horse1', code: recovery },
    ]);
  });

  it('checks the fields before asking the server', async () => {
    const { api } = account();
    renderAt('/account', { auth: api });
    const region = await section();
    fireEvent.click(within(region).getByRole('button', { name: 'Move to a new phone' }));
    click('Continue');
    expect(await within(region).findByText(MESSAGES.passwordRequired)).toBeInTheDocument();
    expect(within(region).getByText('Enter a 6-digit code or a recovery code')).toBeInTheDocument();
    expect(api.callsTo('startTwoFactorMove')).toEqual([]);
  });

  it('shows a refused start as a fixed message', async () => {
    const { api } = account();
    renderAt('/account', { auth: api });
    const region = await section();
    fireEvent.click(within(region).getByRole('button', { name: 'Move to a new phone' }));
    type('Your password', 'wrong-password');
    type('Code from your current phone, or a recovery code', FAKE_TOTP);
    click('Continue');
    expect(await within(region).findByRole('alert')).toHaveTextContent(MESSAGES.badPassword);
    expect(screen.getByRole('heading', { name: /Step 1 of 3/ })).toBeInTheDocument();
  });

  it('keeps the step open after a wrong code from the new phone', async () => {
    const { api } = account();
    const region = await startMove(api);
    await stepHeading(/Step 2 of 3/);
    type('6-digit code from the new phone', '111111');
    click('Move to this phone');
    expect(await within(region).findByRole('alert')).toHaveTextContent(MESSAGES.badCode);
    type('6-digit code from the new phone', FAKE_NEW_TOTP);
    click('Move to this phone');
    expect(await stepHeading(/Step 3 of 3/)).toBeInTheDocument();
  });

  it('offers to start again when the new secret has expired', async () => {
    const { api } = account();
    api.moveExpired = true;
    const region = await startMove(api);
    await stepHeading(/Step 2 of 3/);
    type('6-digit code from the new phone', FAKE_NEW_TOTP);
    click('Move to this phone');
    expect(await within(region).findByRole('alert')).toHaveTextContent(MESSAGES.moveExpired);
    click('Start again');
    await expectFocused(stepHeading(/Step 1 of 3/));
  });

  it('cancel discards the new secret and leaves the current phone in use', async () => {
    const { api } = account();
    const region = await startMove(api);
    await stepHeading(/Step 2 of 3/);
    click('Cancel');
    await waitFor(() => expect(api.callsTo('cancelTwoFactorMove')).toHaveLength(1));
    expect(await within(region).findByRole('status')).toHaveTextContent(
      'Nothing changed. Your current phone still works.',
    );
    await expectFocused(screen.getByRole('heading', { name: 'Move to a new phone' }));
  });

  it('cancel on the first step needs no server call', async () => {
    const { api } = account();
    renderAt('/account', { auth: api });
    const region = await section();
    fireEvent.click(within(region).getByRole('button', { name: 'Move to a new phone' }));
    click('Cancel');
    expect(
      await within(region).findByRole('button', { name: 'Move to a new phone' }),
    ).toBeInTheDocument();
    expect(api.callsTo('cancelTwoFactorMove')).toEqual([]);
  });

  it('asks a Google-only account for a code only, or a fresh Google sign-in', async () => {
    const { api } = account({ hasPassword: false, googleConnected: true });
    api.recentSignIn = false;
    renderAt('/account', { auth: api });
    const region = await section();
    fireEvent.click(within(region).getByRole('button', { name: 'Move to a new phone' }));
    expect(within(region).queryByLabelText('Your password')).toBeNull();
    type('Code from your current phone, or a recovery code', FAKE_TOTP);
    click('Continue');
    expect(await within(region).findByRole('alert')).toHaveTextContent(MESSAGES.moveRecentSignIn);
    click('Sign in with Google again');
    await waitFor(() => expect(api.callsTo('startGoogleSignIn')).toEqual([{ next: '/account' }]));

    api.recentSignIn = true;
    click('Continue');
    expect(await stepHeading(/Step 2 of 3/)).toBeInTheDocument();
    expect(api.callsTo('startTwoFactorMove').at(-1)).toEqual({ code: FAKE_TOTP });
  });
});
