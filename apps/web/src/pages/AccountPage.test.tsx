import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FAKE_SECRET, FAKE_TOTP, FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';

function signedIn({ twoFactorEnabled = false, requiresTwoFactor = false, ownsTrees = false } = {}) {
  const api = new FakeAuthApi();
  const user = api.addUser(
    { email: 'ada@example.com', name: 'Ada', twoFactorEnabled, requiresTwoFactor, ownsTrees },
    { signedIn: true },
  );
  return { api, user };
}

const status = () => screen.getByText('Two-step verification', { selector: 'dt' }).nextSibling;

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function enterPassword(submit: string, password = 'correct-horse') {
  type('Your password', password);
  fireEvent.click(screen.getByRole('button', { name: submit }));
}

describe('AccountPage', () => {
  it('shows name, email and 2FA status', async () => {
    renderAt('/account', { auth: signedIn().api });
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(status()).toHaveTextContent('Off');
  });

  it('changes the password', async () => {
    const { api } = signedIn();
    renderAt('/account', { auth: api });
    await screen.findByText('ada@example.com');
    type('Current password', 'correct-horse');
    type('New password', 'brand-new-password');
    type('Repeat new password', 'brand-new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    expect(api.users.get('ada@example.com')!.password).toBe('brand-new-password');
  });

  it('shows a wrong current password', async () => {
    renderAt('/account', { auth: signedIn().api });
    await screen.findByText('ada@example.com');
    type('Current password', 'not-my-password');
    type('New password', 'brand-new-password');
    type('Repeat new password', 'brand-new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.badPassword);
  });

  it('checks the repeated new password matches', async () => {
    const { api } = signedIn();
    renderAt('/account', { auth: api });
    await screen.findByText('ada@example.com');
    type('Current password', 'correct-horse');
    type('New password', 'brand-new-password');
    type('Repeat new password', 'brand-new-passw0rd');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The passwords don’t match')).toBeInTheDocument();
    expect(api.callsTo('changePassword')).toHaveLength(0);
  });

  it('validates the new password', async () => {
    const { api } = signedIn();
    renderAt('/account', { auth: api });
    await screen.findByText('ada@example.com');
    type('Current password', 'correct-horse');
    type('New password', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
    expect(api.callsTo('changePassword')).toHaveLength(0);
  });

  it('turns on 2FA: QR code, confirm, 8 recovery codes shown once', async () => {
    const { api } = signedIn();
    renderAt('/account', { auth: api });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on two-step verification' }));
    await enterPassword('Continue');

    const qr = await screen.findByAltText('QR code for your authenticator app');
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByText(FAKE_SECRET)).toBeInTheDocument();

    type('6-digit code from the app', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.badCode);

    type('6-digit code from the app', FAKE_TOTP);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download as .txt' })).toBeInTheDocument();
    expect(status()).toHaveTextContent('On');

    fireEvent.click(screen.getByRole('button', { name: "I've saved these codes" }));
    expect(screen.queryByRole('list', { name: 'Recovery codes' })).not.toBeInTheDocument();
    expect(await screen.findByText('Two-step verification is on.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate new recovery codes' })).toBeVisible();
  });

  it('shows a wrong password when starting setup', async () => {
    renderAt('/account', { auth: signedIn().api });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on two-step verification' }));
    await enterPassword('Continue', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.badPassword);
  });

  it('regenerates recovery codes', async () => {
    const { api, user } = signedIn({ twoFactorEnabled: true });
    const old = [...user.recoveryCodes];
    renderAt('/account', { auth: api });
    fireEvent.click(await screen.findByRole('button', { name: 'Generate new recovery codes' }));
    await enterPassword('Generate codes');
    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    const shown = within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(shown).toHaveLength(8);
    expect(shown).toEqual(user.recoveryCodes);
    expect(shown).not.toEqual(old);
    fireEvent.click(screen.getByRole('button', { name: "I've saved these codes" }));
    expect(screen.queryByRole('list', { name: 'Recovery codes' })).not.toBeInTheDocument();
    expect(
      await screen.findByText('New recovery codes are ready; the old ones no longer work.'),
    ).toBeInTheDocument();
  });

  it('keeps showing the codes when the refresh after confirming fails', async () => {
    const { api } = signedIn();
    renderAt('/account', { auth: api });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on two-step verification' }));
    await enterPassword('Continue');
    await screen.findByAltText('QR code for your authenticator app');
    api.failNext('getMe', { code: 'NETWORK', message: MESSAGES.network });
    type('6-digit code from the app', FAKE_TOTP);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(api.callsTo('getMe').length).toBeGreaterThanOrEqual(2);
  });

  it('moves focus to each step heading', async () => {
    const { api } = signedIn();
    renderAt('/account', { auth: api });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on two-step verification' }));
    // Focus moves in an effect after the step renders, so wait for it rather than assume it.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Turn on two-step verification' })).toHaveFocus(),
    );
    await enterPassword('Continue');
    const scan = await screen.findByRole('heading', { name: 'Scan with your authenticator app' });
    await waitFor(() => expect(scan).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Two-step verification', level: 2 }),
      ).toHaveFocus(),
    );
  });

  it('downloads the codes as a text file', async () => {
    const createObjectURL = vi.fn(() => 'blob:codes');
    const revokeObjectURL = vi.fn();
    // jsdom has no blob URLs; add them for this test only.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.isConnected).toBe(true);
      expect(this.download).toBe('family-tree-recovery-codes.txt');
    });
    try {
      const { api } = signedIn({ twoFactorEnabled: true });
      renderAt('/account', { auth: api });
      fireEvent.click(await screen.findByRole('button', { name: 'Generate new recovery codes' }));
      await enterPassword('Generate codes');
      fireEvent.click(await screen.findByRole('button', { name: 'Download as .txt' }));
      expect(click).toHaveBeenCalledOnce();
      expect(document.querySelector('a[download]')).toBeNull();
      // Revoked on a later tick, not straight after the click.
      expect(revokeObjectURL).not.toHaveBeenCalled();
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:codes'));
    } finally {
      click.mockRestore();
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });

  it('turns 2FA off', async () => {
    const { api } = signedIn({ twoFactorEnabled: true });
    renderAt('/account', { auth: api });
    await screen.findByText('ada@example.com');
    expect(status()).toHaveTextContent('On');
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-step verification' }));
    await enterPassword('Turn off');
    expect(await screen.findByText('Two-step verification is off.')).toBeInTheDocument();
    expect(status()).toHaveTextContent('Off');
    expect(screen.getByRole('button', { name: 'Turn on two-step verification' })).toBeVisible();
  });

  it('hides Turn off and explains why when 2FA is required', async () => {
    const { api } = signedIn({ twoFactorEnabled: true, requiresTwoFactor: true });
    renderAt('/account', { auth: api });
    await screen.findByText('ada@example.com');
    expect(screen.queryByRole('button', { name: 'Turn off two-step verification' })).toBeNull();
    expect(
      screen.getByText('Tree owners and branch stewards must keep two-step verification on.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate new recovery codes' })).toBeVisible();
  });

  describe('delete account', () => {
    const typePassword = (value: string) =>
      fireEvent.change(screen.getByLabelText('Your password to confirm'), { target: { value } });
    const confirm = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    };

    it('deletes the account and ends on home, signed out', async () => {
      const { api } = signedIn();
      renderAt('/account', { auth: api });
      await screen.findByText('ada@example.com');
      typePassword('correct-horse');
      confirm();
      expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
      expect(api.users.size).toBe(0);
    });

    it('shows the owns-trees message', async () => {
      const { api } = signedIn({ ownsTrees: true });
      renderAt('/account', { auth: api });
      await screen.findByText('ada@example.com');
      typePassword('correct-horse');
      confirm();
      expect(await screen.findByText(MESSAGES.ownsTrees)).toBeInTheDocument();
    });

    it('shows a wrong password', async () => {
      const { api } = signedIn();
      renderAt('/account', { auth: api });
      await screen.findByText('ada@example.com');
      typePassword('wrong-password');
      confirm();
      expect(await screen.findByText(MESSAGES.badPassword)).toBeInTheDocument();
    });

    it('asks for the password first, without calling the API', async () => {
      const { api } = signedIn();
      renderAt('/account', { auth: api });
      await screen.findByText('ada@example.com');
      confirm();
      expect(await screen.findByText('Enter your password')).toBeInTheDocument();
      expect(api.callsTo('deleteAccount')).toHaveLength(0);
    });
  });

  it('re-reads the session when opened, so requirements are current', async () => {
    const { api } = signedIn({ twoFactorEnabled: true });
    renderAt('/account', { auth: api });
    await screen.findByText('ada@example.com');
    await waitFor(() => expect(api.callsTo('getMe').length).toBeGreaterThanOrEqual(2));
  });

  it('shows a fixed message when the server refuses to turn 2FA off for a role', async () => {
    const { api } = signedIn({ twoFactorEnabled: true });
    api.failNext('disableTwoFactor', {
      code: 'TWO_FACTOR_REQUIRED_FOR_ROLE',
      message: MESSAGES.twoFactorForRole,
    });
    renderAt('/account', { auth: api });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off two-step verification' }));
    await enterPassword('Turn off');
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.twoFactorForRole);
  });
});
