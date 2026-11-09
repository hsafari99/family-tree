import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeTreesApi } from '../test/fake-trees';
import { renderAt } from '../test/render';

function setup({ twoFactorEnabled = true } = {}) {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'ada@example.com', name: 'Ada', twoFactorEnabled }, { signedIn: true });
  return { auth, trees: new FakeTreesApi() };
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('NewTreePage', () => {
  it('explains the 2FA requirement and shows no form without 2FA', async () => {
    renderAt('/trees/new', setup({ twoFactorEnabled: false }));
    expect(
      await screen.findByText(/Tree owners must use two-step verification/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Turn on two-step verification' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Tree name')).not.toBeInTheDocument();
  });

  it('fills the tree name from the surname until it is edited by hand', async () => {
    renderAt('/trees/new', setup());
    await screen.findByLabelText('Tree name');
    type('Your last name', 'Hale');
    expect(screen.getByLabelText('Tree name')).toHaveValue('Hale family');
    type('Tree name', 'The Hales');
    type('Your last name', 'Smith');
    expect(screen.getByLabelText('Tree name')).toHaveValue('The Hales');
  });

  it('shows a field error for an empty first name and makes no call', async () => {
    const { auth, trees } = setup();
    renderAt('/trees/new', { auth, trees });
    await screen.findByLabelText('Tree name');
    type('Tree name', 'Hale family');
    fireEvent.click(screen.getByRole('button', { name: 'Start tree' }));
    expect(await screen.findByText('Enter a first name')).toBeInTheDocument();
    expect(trees.callsTo('createTree')).toHaveLength(0);
  });

  it('rejects a birth year in the future', async () => {
    const { auth, trees } = setup();
    renderAt('/trees/new', { auth, trees });
    await screen.findByLabelText('Tree name');
    type('Tree name', 'Hale family');
    type('Your first name', 'Ada');
    type('Birth year', '3000');
    fireEvent.click(screen.getByRole('button', { name: 'Start tree' }));
    expect(await screen.findByText('That year is in the future')).toBeInTheDocument();
    expect(trees.callsTo('createTree')).toHaveLength(0);
  });

  it('creates the tree and lands on its page', async () => {
    const { auth, trees } = setup();
    renderAt('/trees/new', { auth, trees });
    await screen.findByLabelText('Tree name');
    type('Your first name', 'Ada');
    type('Your last name', 'Hale');
    type('Birth year', '1990');
    fireEvent.click(screen.getByRole('button', { name: 'Start tree' }));
    expect(await screen.findByRole('heading', { name: 'Hale family' })).toBeInTheDocument();
    expect(trees.callsTo('createTree')).toEqual([
      {
        name: 'Hale family',
        person: { givenName: 'Ada', surname: 'Hale', sex: 'unknown', birthYear: 1990 },
      },
    ]);
  });

  it('shows the quota message', async () => {
    const { auth, trees } = setup();
    trees.quotaLeft = 0;
    renderAt('/trees/new', { auth, trees });
    await screen.findByLabelText('Tree name');
    type('Tree name', 'Hale family');
    type('Your first name', 'Ada');
    fireEvent.click(screen.getByRole('button', { name: 'Start tree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.quota);
  });

  it('redirects to sign-in when signed out', async () => {
    renderAt('/trees/new');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('re-reads the session and shows the message on TWO_FACTOR_REQUIRED', async () => {
    const { auth, trees } = setup();
    trees.failNext('createTree', {
      code: 'TWO_FACTOR_REQUIRED',
      message: MESSAGES.twoFactorRequired,
    });
    renderAt('/trees/new', { auth, trees });
    await screen.findByLabelText('Tree name');
    const before = auth.callsTo('getMe').length;
    type('Tree name', 'Hale family');
    type('Your first name', 'Ada');
    fireEvent.click(screen.getByRole('button', { name: 'Start tree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.twoFactorRequired);
    await waitFor(() => expect(auth.callsTo('getMe').length).toBeGreaterThan(before));
  });
});
