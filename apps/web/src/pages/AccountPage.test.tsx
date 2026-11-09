import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FAKE_SECRET, FAKE_TOTP, FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';

function signedIn({ twoFactorEnabled = false } = {}) {
  const api = new FakeAuthApi();
  const user = api.addUser(
    { email: 'ada@example.com', name: 'Ada', twoFactorEnabled },
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
    renderAt('/account', signedIn().api);
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(status()).toHaveTextContent('Off');
  });

  it('changes the password', async () => {
    const { api } = signedIn();
    renderAt('/account', api);
    await screen.findByText('ada@example.com');
    type('Current password', 'correct-horse');
    type('New password', 'brand-new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    expect(api.users.get('ada@example.com')!.password).toBe('brand-new-password');
  });

  it('shows a wrong current password', async () => {
    renderAt('/account', signedIn().api);
    await screen.findByText('ada@example.com');
    type('Current password', 'not-my-password');
    type('New password', 'brand-new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.badPassword);
  });

  it('validates the new password', async () => {
    const { api } = signedIn();
    renderAt('/account', api);
    await screen.findByText('ada@example.com');
    type('Current password', 'correct-horse');
    type('New password', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
    expect(api.callsTo('changePassword')).toHaveLength(0);
  });

  it('turns on 2FA: QR code, confirm, 8 recovery codes shown once', async () => {
    const { api } = signedIn();
    renderAt('/account', api);
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
    renderAt('/account', signedIn().api);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on two-step verification' }));
    await enterPassword('Continue', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.badPassword);
  });

  it('regenerates recovery codes', async () => {
    const { api, user } = signedIn({ twoFactorEnabled: true });
    const old = [...user.recoveryCodes];
    renderAt('/account', api);
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
  });

  it('turns 2FA off', async () => {
    const { api } = signedIn({ twoFactorEnabled: true });
    renderAt('/account', api);
    await screen.findByText('ada@example.com');
    expect(status()).toHaveTextContent('On');
    fireEvent.click(screen.getByRole('button', { name: 'Turn off two-step verification' }));
    await enterPassword('Turn off');
    expect(await screen.findByText('Two-step verification is off.')).toBeInTheDocument();
    expect(status()).toHaveTextContent('Off');
    expect(screen.getByRole('button', { name: 'Turn on two-step verification' })).toBeVisible();
  });
});
