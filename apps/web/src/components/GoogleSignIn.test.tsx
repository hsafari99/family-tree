import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeTreesApi } from '../test/fake-trees';
import { renderAt } from '../test/render';

const google = () => screen.findByRole('button', { name: 'Continue with Google' });

function withGoogle(on = true) {
  const auth = new FakeAuthApi();
  auth.providers = { google: on };
  return auth;
}

describe('Continue with Google', () => {
  it('is on the sign-in page and keeps the return path', async () => {
    const { api } = renderAt('/sign-in?next=%2Finvite%2Fabc', { auth: withGoogle() });
    fireEvent.click(await google());
    expect(api.callsTo('startGoogleSignIn')).toEqual([{ next: '/invite/abc' }]);
    // The real API leaves the page; until then the button can't be pressed twice.
    expect(await screen.findByRole('button', { name: 'Opening Google…' })).toBeDisabled();
  });

  it('drops an off-site return path', async () => {
    const { api } = renderAt('/sign-in?next=%2F%2Fevil.example', { auth: withGoogle() });
    fireEvent.click(await google());
    expect(api.callsTo('startGoogleSignIn')).toEqual([{ next: '/' }]);
  });

  it('is on the sign-up page', async () => {
    const { api } = renderAt('/sign-up?next=%2Ftrees%2Fnew', { auth: withGoogle() });
    fireEvent.click(await google());
    expect(api.callsTo('startGoogleSignIn')).toEqual([{ next: '/trees/new' }]);
  });

  it('is hidden when Google sign-in is off', async () => {
    const { api } = renderAt('/sign-in', { auth: withGoogle(false) });
    await screen.findByRole('button', { name: 'Sign in' });
    await waitFor(() => expect(api.callsTo('getProviders')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  });

  it('shows a fixed message when starting fails', async () => {
    const auth = withGoogle();
    auth.failNext('startGoogleSignIn', { code: 'RATE_LIMITED', message: MESSAGES.tooMany });
    renderAt('/sign-in', { auth });
    fireEvent.click(await google());
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.tooMany);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });

  it('explains a refused sign-in for an email that already has an account', async () => {
    renderAt('/sign-in?error=account_not_linked', { auth: withGoogle() });
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.googleEmailTaken);
  });

  it('never shows the raw error code from the URL', async () => {
    renderAt('/sign-in?error=%3Cb%3Eyou+were+hacked%3C%2Fb%3E', { auth: withGoogle() });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(MESSAGES.googleFailed);
    expect(alert).not.toHaveTextContent('hacked');
  });

  it('is offered on an invite to a signed-out visitor, returning to the invite', async () => {
    const auth = withGoogle();
    const trees = new FakeTreesApi();
    const treeId = trees.addTree({ name: 'Hale family' });
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789';
    trees.addInviteToken(token, {
      treeId,
      treeName: 'Hale family',
      inviterName: 'Bob',
      role: 'viewer',
      steward: false,
      targetPersonName: null,
    });
    const { api } = renderAt(`/invite/${token}`, { auth, trees });
    fireEvent.click(await google());
    expect(api.callsTo('startGoogleSignIn')).toEqual([{ next: `/invite/${token}` }]);
  });

  it('is not offered on an invite once signed in', async () => {
    const auth = withGoogle();
    auth.addUser({ email: 'ada@example.com', name: 'Ada' }, { signedIn: true });
    const trees = new FakeTreesApi();
    const treeId = trees.addTree({ name: 'Hale family' });
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789';
    trees.addInviteToken(token, {
      treeId,
      treeName: 'Hale family',
      inviterName: 'Bob',
      role: 'viewer',
      steward: false,
      targetPersonName: null,
    });
    renderAt(`/invite/${token}`, { auth, trees });
    expect(await screen.findByRole('button', { name: 'Join Hale family' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  });
});
