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

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function enterPassword(submit: string, password = 'Correct-horse1') {
  type('Your password', password);
  fireEvent.click(screen.getByRole('button', { name: submit }));
}

describe('AccountPage', () => {
  it('lists the sections with their status and opens one per URL', async () => {
    renderAt('/account/two-step', { auth: signedIn({ twoFactorEnabled: true }).api });
    const nav = await screen.findByRole('navigation', { name: 'Account settings' });
    expect(within(nav).getByRole('link', { name: 'Two-step verification' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Two-step verification' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Change password' })).toBeNull();
    // One short label per item: no status or description line under it.
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Profile', 'Change password', 'Two-step verification', 'Delete account']);
  });

  it('gives each nav item a decorative icon before its label', async () => {
    renderAt('/account', { auth: signedIn().api });
    const nav = await screen.findByRole('navigation', { name: 'Account settings' });
    for (const link of within(nav).getAllByRole('link')) {
      const icon = link.firstElementChild;
      expect(icon?.tagName.toLowerCase()).toBe('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
    expect(within(nav).getByRole('link', { name: 'Profile' })).toBeInTheDocument();
  });

  it('has an icon link back to home before the title', async () => {
    renderAt('/account/password', { auth: signedIn().api });
    const home = await screen.findByRole('link', { name: 'Back to home' });
    expect(home).toHaveAttribute('href', '/');
    expect(home).toHaveAttribute('title', 'Back to home');
    expect(home).toHaveTextContent('');
    expect(home.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    const title = screen.getByRole('heading', { level: 1, name: 'Account' });
    expect(home.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(home);
    expect(await screen.findByRole('heading', { name: 'Your trees' })).toBeInTheDocument();
  });

  it('/account shows the profile', async () => {
    renderAt('/account', { auth: signedIn().api });
    expect(await screen.findByRole('heading', { level: 2, name: 'Profile' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Account settings' });
    // The default section is the one shown, so it is the one marked current.
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveAccessibleName('Profile');
  });

  it('opening another section moves focus to its heading', async () => {
    renderAt('/account/profile', { auth: signedIn().api });
    const nav = await screen.findByRole('navigation', { name: 'Account settings' });
    expect(screen.getByRole('heading', { level: 2, name: 'Profile' })).not.toHaveFocus();
    fireEvent.click(within(nav).getByRole('link', { name: 'Change password' }));
    const heading = await screen.findByRole('heading', { level: 2, name: 'Change password' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveAccessibleName(
      'Change password',
    );
  });

  it('a section page has a back link to the list (shown on mobile)', async () => {
    renderAt('/account/password', { auth: signedIn().api });
    expect(await screen.findByRole('link', { name: 'Back to account' })).toHaveAttribute(
      'href',
      '/account',
    );
  });

  it('an unknown section falls back to the profile, marked current', async () => {
    renderAt('/account/bogus', { auth: signedIn().api });
    expect(await screen.findByRole('heading', { level: 2, name: 'Profile' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Account settings' });
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveAccessibleName('Profile');
    expect(screen.queryByRole('heading', { name: /not found/i })).toBeNull();
  });

  it('Delete account is its own danger section', async () => {
    renderAt('/account/delete', { auth: signedIn().api });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Delete account' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Delete account' })).toHaveClass('danger');
  });

  it('shows name and email', async () => {
    renderAt('/account/profile', { auth: signedIn().api });
    const profile = await screen.findByRole('region', { name: 'Profile' });
    expect(within(profile).getByText('Ada')).toBeInTheDocument();
    expect(within(profile).getByText('ada@example.com')).toBeInTheDocument();
  });

  describe('profile picture', () => {
    const pick = (name: string, file: File) =>
      fireEvent.change(screen.getByLabelText(name), { target: { files: [file] } });
    const image = (type = 'image/png', size = 100) =>
      new File([new Uint8Array(size)], 'me.png', { type });

    it('shows the default picture, then uploads, replaces and removes one', async () => {
      const { api, user } = signedIn();
      renderAt('/account/profile', { auth: api });
      const profile = await screen.findByRole('region', { name: 'Profile' });
      expect(within(profile).getByRole('img', { name: 'Ada' })).toHaveTextContent('A');
      expect(within(profile).queryByRole('button', { name: 'Remove picture' })).toBeNull();
      // Details first (left column), then the picture, shown large, with its controls under it.
      const picture = within(profile).getByRole('img', { name: 'Ada' });
      expect(picture).toHaveStyle({ width: '160px', height: '160px' });
      // Compact icon controls, named for assistive tech and titled for a tooltip.
      const choose = within(profile).getByLabelText('Upload a picture');
      expect(choose.closest('label')).toHaveAttribute('title', 'Upload a picture');
      expect(choose.closest('label')).toHaveClass('icon-button');
      const details = within(profile).getByText('ada@example.com').closest('dl')!;
      expect(
        details.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        picture.compareDocumentPosition(within(profile).getByLabelText('Upload a picture')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      pick('Upload a picture', image());
      expect(await within(profile).findByText('Profile picture added.')).toBeInTheDocument();
      const first = user.avatarUrl!;
      expect(within(profile).getByRole('img', { name: 'Ada' })).toHaveAttribute('src', first);
      expect(api.callsTo('uploadAvatar')).toHaveLength(1);

      pick('Replace picture', image('image/webp'));
      expect(await within(profile).findByText('Profile picture replaced.')).toBeInTheDocument();
      expect(within(profile).getByRole('img', { name: 'Ada' })).not.toHaveAttribute('src', first);

      const removeButton = within(profile).getByRole('button', { name: 'Remove picture' });
      expect(removeButton).toHaveAttribute('title', 'Remove picture');
      expect(removeButton).toHaveTextContent('');
      expect(removeButton.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      fireEvent.click(removeButton);
      // The confirm step stays.
      expect(user.avatarUrl).not.toBeNull();
      fireEvent.click(within(profile).getByRole('button', { name: 'Yes, remove' }));
      expect(await within(profile).findByText('Profile picture removed.')).toBeInTheDocument();
      expect(user.avatarUrl).toBeNull();
      expect(within(profile).getByRole('img', { name: 'Ada' }).tagName).toBe('SPAN');
      expect(within(profile).getByLabelText('Upload a picture')).toBeInTheDocument();
    });

    it('refuses a wrong type or a too-large file without calling the server', async () => {
      const { api } = signedIn();
      renderAt('/account/profile', { auth: api });
      await screen.findByRole('region', { name: 'Profile' });
      pick('Upload a picture', image('image/gif'));
      expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.photoType);
      pick('Upload a picture', image('image/png', 5 * 1024 * 1024 + 1));
      expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.avatarTooLarge);
      expect(api.callsTo('uploadAvatar')).toHaveLength(0);
    });

    it('shows a server refusal as its fixed message', async () => {
      const { api } = signedIn();
      api.failNext('uploadAvatar', { code: 'VALIDATION', message: MESSAGES.photoUnreadable });
      renderAt('/account/profile', { auth: api });
      await screen.findByRole('region', { name: 'Profile' });
      pick('Upload a picture', image());
      expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.photoUnreadable);
    });
  });

  it('changes the password', async () => {
    const { api } = signedIn();
    renderAt('/account/password', { auth: api });
    await screen.findByRole('navigation', { name: 'Account settings' });
    type('Current password', 'Correct-horse1');
    type('New password', 'Brand-new-password1');
    type('Repeat new password', 'Brand-new-password1');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    expect(api.users.get('ada@example.com')!.password).toBe('Brand-new-password1');
  });

  it('shows a wrong current password', async () => {
    renderAt('/account/password', { auth: signedIn().api });
    await screen.findByRole('navigation', { name: 'Account settings' });
    type('Current password', 'not-my-password');
    type('New password', 'Brand-new-password1');
    type('Repeat new password', 'Brand-new-password1');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.badPassword);
  });

  it('checks the repeated new password matches', async () => {
    const { api } = signedIn();
    renderAt('/account/password', { auth: api });
    await screen.findByRole('navigation', { name: 'Account settings' });
    type('Current password', 'Correct-horse1');
    type('New password', 'Brand-new-password1');
    type('Repeat new password', 'Brand-new-passw0rd');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The passwords don’t match')).toBeInTheDocument();
    expect(api.callsTo('changePassword')).toHaveLength(0);
  });

  it('validates the new password', async () => {
    const { api } = signedIn();
    renderAt('/account/password', { auth: api });
    await screen.findByRole('navigation', { name: 'Account settings' });
    type('Current password', 'Correct-horse1');
    type('New password', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
    expect(api.callsTo('changePassword')).toHaveLength(0);
  });

  it('turns on 2FA: QR code, confirm, 8 recovery codes shown once', async () => {
    const { api } = signedIn();
    renderAt('/account/two-step', { auth: api });
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

    fireEvent.click(screen.getByRole('button', { name: "I've saved these codes" }));
    expect(screen.queryByRole('list', { name: 'Recovery codes' })).not.toBeInTheDocument();
    expect(await screen.findByText('Two-step verification is on.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate new recovery codes' })).toBeVisible();
  });

  it('shows a wrong password when starting setup', async () => {
    renderAt('/account/two-step', { auth: signedIn().api });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on two-step verification' }));
    await enterPassword('Continue', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.badPassword);
  });

  it('regenerates recovery codes', async () => {
    const { api, user } = signedIn({ twoFactorEnabled: true });
    const old = [...user.recoveryCodes];
    renderAt('/account/two-step', { auth: api });
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
    renderAt('/account/two-step', { auth: api });
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
    renderAt('/account/two-step', { auth: api });
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
      renderAt('/account/two-step', { auth: api });
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
    renderAt('/account/two-step', { auth: api });
    await screen.findByRole('navigation', { name: 'Account settings' });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-step verification' }));
    await enterPassword('Turn off');
    expect(await screen.findByText('Two-step verification is off.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on two-step verification' })).toBeVisible();
  });

  it('hides Turn off and explains why when 2FA is required', async () => {
    const { api } = signedIn({ twoFactorEnabled: true, requiresTwoFactor: true });
    renderAt('/account/two-step', { auth: api });
    await screen.findByRole('navigation', { name: 'Account settings' });
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
      renderAt('/account/delete', { auth: api });
      await screen.findByRole('navigation', { name: 'Account settings' });
      typePassword('Correct-horse1');
      confirm();
      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      expect(api.users.size).toBe(0);
    });

    it('shows the owns-trees message', async () => {
      const { api } = signedIn({ ownsTrees: true });
      renderAt('/account/delete', { auth: api });
      await screen.findByRole('navigation', { name: 'Account settings' });
      typePassword('Correct-horse1');
      confirm();
      expect(await screen.findByText(MESSAGES.ownsTrees)).toBeInTheDocument();
    });

    it('shows a wrong password', async () => {
      const { api } = signedIn();
      renderAt('/account/delete', { auth: api });
      await screen.findByRole('navigation', { name: 'Account settings' });
      typePassword('wrong-password');
      confirm();
      expect(await screen.findByText(MESSAGES.badPassword)).toBeInTheDocument();
    });

    it('asks for the password first, without calling the API', async () => {
      const { api } = signedIn();
      renderAt('/account/delete', { auth: api });
      await screen.findByRole('navigation', { name: 'Account settings' });
      confirm();
      expect(await screen.findByText('Enter your password')).toBeInTheDocument();
      expect(api.callsTo('deleteAccount')).toHaveLength(0);
    });
  });

  it('re-reads the session when opened, so requirements are current', async () => {
    const { api } = signedIn({ twoFactorEnabled: true });
    renderAt('/account', { auth: api });
    await screen.findByRole('navigation', { name: 'Account settings' });
    await waitFor(() => expect(api.callsTo('getMe').length).toBeGreaterThanOrEqual(2));
  });

  it('shows a fixed message when the server refuses to turn 2FA off for a role', async () => {
    const { api } = signedIn({ twoFactorEnabled: true });
    api.failNext('disableTwoFactor', {
      code: 'TWO_FACTOR_REQUIRED_FOR_ROLE',
      message: MESSAGES.twoFactorForRole,
    });
    renderAt('/account/two-step', { auth: api });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off two-step verification' }));
    await enterPassword('Turn off');
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.twoFactorForRole);
  });
});
