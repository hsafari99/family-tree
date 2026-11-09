import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeAuthApi } from '../test/fake-auth';
import { renderAt } from '../test/render';
import { INVALID_LINK } from './ResetLinkPage';

const TOKEN = 'a'.repeat(43);

function submit(newPassword: string) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: newPassword } });
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
}

describe('ResetLinkPage', () => {
  it('sets a new password with a valid link', async () => {
    const api = new FakeAuthApi();
    api.addUser({ email: 'ada@example.com' });
    api.resetTokens.set(TOKEN, 'ada@example.com');
    renderAt(`/reset/${TOKEN}`, api);
    await screen.findByLabelText('New password');
    submit('brand-new-password');
    expect(
      await screen.findByText('Password changed — sign in with your new password'),
    ).toBeInTheDocument();
    expect(api.callsTo('resetWithLink')).toEqual([
      { token: TOKEN, newPassword: 'brand-new-password' },
    ]);
  });

  it('says when the link is invalid or used', async () => {
    renderAt(`/reset/${TOKEN}`);
    await screen.findByLabelText('New password');
    submit('brand-new-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_LINK);
  });

  it('rejects a malformed token without calling the API', async () => {
    const { api } = renderAt('/reset/short');
    await screen.findByLabelText('New password');
    submit('brand-new-password');
    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_LINK);
    expect(api.callsTo('resetWithLink')).toHaveLength(0);
  });

  it('validates the new password', async () => {
    renderAt(`/reset/${TOKEN}`);
    await screen.findByLabelText('New password');
    submit('short');
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
  });
});
