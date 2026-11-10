import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeTreesApi } from '../test/fake-trees';
import { renderAt } from '../test/render';

function setup() {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'ada@example.com', name: 'Ada' }, { signedIn: true });
  return { auth, trees: new FakeTreesApi() };
}

describe('MyTrees', () => {
  it('lists trees with their roles and links', async () => {
    const { auth, trees } = setup();
    const a = trees.addTree({ name: 'Hale family', role: 'owner' });
    const b = trees.addTree({ name: 'Lovelace family', role: 'viewer' });
    renderAt('/', { auth, trees });
    expect(await screen.findByRole('heading', { name: 'Your trees' })).toBeInTheDocument();
    const hale = await screen.findByRole('link', { name: 'Hale family' });
    expect(hale).toHaveAttribute('href', `/trees/${a}`);
    expect(hale.closest('li')).toHaveTextContent('Owner');
    const lovelace = screen.getByRole('link', { name: 'Lovelace family' });
    expect(lovelace).toHaveAttribute('href', `/trees/${b}`);
    expect(lovelace.closest('li')).toHaveTextContent('Viewer');
    expect(screen.getByRole('link', { name: 'Start a new tree' })).toHaveAttribute(
      'href',
      '/trees/new',
    );
  });

  it('shows the empty state', async () => {
    renderAt('/', setup());
    expect(await screen.findByText("You don't have any trees yet.")).toBeInTheDocument();
  });

  it('shows an alert on a list error and reloads on Try again', async () => {
    const { auth, trees } = setup();
    trees.addTree({ name: 'Hale family' });
    trees.failNext('listTrees', { code: 'NETWORK', message: MESSAGES.network });
    renderAt('/', { auth, trees });
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.network);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Hale family' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('restores a deleted tree and moves it to the main list', async () => {
    const { auth, trees } = setup();
    const id = trees.addTree({ name: 'Hale family' });
    await trees.deleteTree(id);
    renderAt('/', { auth, trees });
    const section = (await screen.findByRole('heading', { name: 'Deleted trees' })).parentElement!;
    expect(within(section).getByText(/Hale family, can be restored until /)).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('link', { name: 'Hale family' })).toHaveAttribute(
      'href',
      `/trees/${id}`,
    );
    expect(trees.callsTo('restoreTree')).toEqual([id]);
    expect(screen.queryByRole('heading', { name: 'Deleted trees' })).not.toBeInTheDocument();
  });

  it('shows a restore failure', async () => {
    const { auth, trees } = setup();
    const id = trees.addTree();
    await trees.deleteTree(id);
    trees.failNext('restoreTree', { code: 'NOT_FOUND', message: MESSAGES.notFound });
    renderAt('/', { auth, trees });
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.notFound);
  });

  it('signed out, shows Sign in and Create an account and no trees', async () => {
    const trees = new FakeTreesApi();
    trees.addTree({ name: 'Hale family' });
    renderAt('/', { trees });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeInTheDocument();
    expect(screen.queryByText('Hale family')).not.toBeInTheDocument();
    expect(trees.callsTo('listTrees')).toHaveLength(0);
  });

  it('shows the quota message when a restore would exceed the limit', async () => {
    const { auth, trees } = setup();
    const id = trees.addTree();
    await trees.deleteTree(id);
    trees.quotaLeft = 0;
    renderAt('/', { auth, trees });
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.quota);
  });
});
