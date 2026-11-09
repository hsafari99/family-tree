import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeTreesApi } from '../test/fake-trees';
import { renderAt } from '../test/render';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

function setup({
  signedIn = false,
  steward = false,
  targetPersonName = null as string | null,
} = {}) {
  const auth = new FakeAuthApi();
  if (signedIn) auth.addUser({ email: 'ada@example.com', name: 'Ada' }, { signedIn: true });
  const trees = new FakeTreesApi();
  const treeId = trees.addTree({ name: 'Hale family' });
  trees.addInviteToken(TOKEN, {
    treeId,
    treeName: 'Hale family',
    inviterName: 'Bob',
    role: 'editor',
    steward,
    targetPersonName,
  });
  return { auth, trees, treeId };
}

describe('InvitePage', () => {
  it('previews the invite for a signed-out visitor with sign-in links that keep the invite', async () => {
    renderAt(`/invite/${TOKEN}`, setup({ targetPersonName: 'Cy Hale' }));
    expect(await screen.findByRole('heading', { name: 'You’re invited' })).toBeInTheDocument();
    expect(screen.getByText('Bob invited you to Hale family as an editor.')).toBeInTheDocument();
    expect(screen.getByText('The invite says you are Cy Hale in the tree.')).toBeInTheDocument();
    const next = encodeURIComponent(`/invite/${TOKEN}`);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/sign-in?next=${next}`,
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      `/sign-up?next=${next}`,
    );
  });

  it('lets a signed-in user join and lands on the tree page', async () => {
    const s = setup({ signedIn: true });
    renderAt(`/invite/${TOKEN}`, s);
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Join Hale family' }));
    expect(await screen.findByRole('heading', { name: 'Hale family' })).toBeInTheDocument();
    expect(s.trees.callsTo('acceptInvite')).toEqual([TOKEN]);
  });

  it('shows the message for an invalid token', async () => {
    renderAt('/invite/not-a-real-token-at-all-0000', setup());
    expect(await screen.findByText(MESSAGES.invalidInvite)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Family Tree' })).toHaveAttribute('href', '/');
  });

  it('shows the invalid message when joining fails', async () => {
    const s = setup({ signedIn: true });
    renderAt(`/invite/${TOKEN}`, s);
    await screen.findByRole('button', { name: 'Join Hale family' });
    s.trees.failNext('acceptInvite', { code: 'INVALID_INVITE', message: MESSAGES.invalidInvite });
    fireEvent.click(screen.getByRole('button', { name: 'Join Hale family' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.invalidInvite);
  });

  it('notes the 2FA requirement for a steward invite', async () => {
    renderAt(`/invite/${TOKEN}`, setup({ steward: true }));
    expect(
      await screen.findByText(
        /look after a branch of the family. That needs two-step verification/,
      ),
    ).toBeInTheDocument();
  });

  it('replaces the invite page in history when joining, and re-reads the session', async () => {
    const s = setup({ signedIn: true });
    const view = renderAt(`/invite/${TOKEN}`, { ...s, entries: ['/', `/invite/${TOKEN}`] });
    fireEvent.click(await screen.findByRole('button', { name: 'Join Hale family' }));
    await screen.findByRole('heading', { name: 'Hale family' });
    // initial load, plus one after joining (joining can make the user an owner or steward)
    await waitFor(() => expect(s.auth.callsTo('getMe').length).toBeGreaterThanOrEqual(2));
    act(() => view.navigate(-1));
    expect(await screen.findByRole('heading', { name: 'Your trees' })).toBeInTheDocument();
  });
});
