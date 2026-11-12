import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeAuthApi } from '../test/fake-auth';
import { fakePerson, FakeTreesApi } from '../test/fake-trees';
import { renderAt } from '../test/render';

function setup() {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'ada@example.com', name: 'Ada Lovelace' }, { signedIn: true });
  return { auth, trees: new FakeTreesApi() };
}

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const card = (name: string) =>
  screen.getByRole('heading', { level: 3, name }).closest('li') as HTMLElement;

describe('HomePage', () => {
  it('welcomes the user by first name', async () => {
    renderAt('/', setup());
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Ada' })).toBeVisible();
  });

  it('shows a card per tree with role, people, last update and an Open button', async () => {
    const { auth, trees } = setup();
    const a = trees.addTree({
      name: 'Hale family',
      role: 'owner',
      persons: [fakePerson(), fakePerson(), fakePerson()],
      updatedAt: ago(3 * HOUR),
      invites: [
        {
          id: crypto.randomUUID(),
          role: 'viewer',
          stewardAnchorPersonId: null,
          targetPersonId: null,
          createdByUserId: crypto.randomUUID(),
          createdByName: 'Ada',
          expiresAt: ago(-HOUR),
        },
      ],
    });
    const b = trees.addTree({
      name: 'Lovelace family',
      role: 'viewer',
      persons: [fakePerson()],
      updatedAt: ago(10_000),
    });
    renderAt('/', { auth, trees });
    expect(await screen.findByRole('heading', { level: 2, name: 'Your trees' })).toBeVisible();

    const hale = await screen.findByRole('heading', { level: 3, name: 'Hale family' });
    const haleCard = card('Hale family');
    expect(hale).toBeVisible();
    expect(haleCard).toHaveTextContent('Owner');
    expect(haleCard).toHaveTextContent('3 people');
    expect(haleCard).toHaveTextContent('Updated 3 hours ago');
    const open = within(haleCard).getByRole('link', { name: 'Open Hale family' });
    expect(open).toHaveAttribute('href', `/trees/${a}`);
    // Open invite links, for those who can see them, lead to the members page.
    expect(within(haleCard).getByRole('link', { name: '1 open invite' })).toHaveAttribute(
      'href',
      `/trees/${a}/members`,
    );

    const lovelace = card('Lovelace family');
    expect(lovelace).toHaveTextContent('Viewer');
    expect(lovelace).toHaveTextContent('1 person');
    expect(lovelace).toHaveTextContent('Updated just now');
    expect(within(lovelace).queryByRole('link', { name: /open invite/ })).toBeNull();
    expect(within(lovelace).getByRole('link', { name: 'Open Lovelace family' })).toHaveAttribute(
      'href',
      `/trees/${b}`,
    );
    expect(screen.getByRole('link', { name: 'Start a new tree' })).toHaveAttribute(
      'href',
      '/trees/new',
    );
    // Not the first-time guide.
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull();
    // One request for the whole page.
    expect(trees.callsTo('homeSummary')).toHaveLength(1);
    expect(trees.callsTo('listTrees')).toHaveLength(0);
  });

  it('lists recent activity with who, what, whom and where', async () => {
    const { auth, trees } = setup();
    const id = trees.addTree({ name: 'Hale family' });
    const leo = crypto.randomUUID();
    trees.activity = [
      {
        id: crypto.randomUUID(),
        treeId: id,
        treeName: 'Hale family',
        action: 'person.update',
        at: ago(2 * HOUR),
        by: 'Grace Hopper',
        person: { id: leo, name: 'Leo Hale' },
      },
      {
        id: crypto.randomUUID(),
        treeId: id,
        treeName: 'Hale family',
        action: 'photo.create',
        at: ago(3 * 86_400_000),
        by: null,
        person: { id: leo, name: 'Leo Hale' },
      },
    ];
    renderAt('/', { auth, trees });
    const section = (await screen.findByRole('heading', { name: 'Recent activity' })).closest(
      'section',
    )!;
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Details changed');
    expect(items[0]).toHaveTextContent('Grace Hopper');
    expect(items[0]).toHaveTextContent('Hale family');
    expect(items[0]).toHaveTextContent('2 hours ago');
    expect(within(items[0]!).getByRole('link', { name: 'Leo Hale' })).toHaveAttribute(
      'href',
      `/trees/${id}/people/${leo}`,
    );
    expect(items[1]).toHaveTextContent('Photo added');
    expect(items[1]).toHaveTextContent('a former member');
    expect(items[1]).toHaveTextContent('3 days ago');
  });

  it('says so when the trees have no activity yet', async () => {
    const { auth, trees } = setup();
    trees.addTree({ name: 'Hale family' });
    renderAt('/', { auth, trees });
    expect(await screen.findByText('No changes yet.')).toBeInTheDocument();
  });

  it('shows a first-time guide with no trees', async () => {
    renderAt('/', setup());
    const guide = (await screen.findByRole('heading', { name: 'Getting started' })).closest(
      'section',
    )!;
    expect(within(guide).getAllByRole('listitem')).toHaveLength(3);
    expect(guide).toHaveTextContent(/two-step verification/);
    expect(guide).toHaveTextContent(/invite link/);
    expect(within(guide).getByRole('link', { name: 'Start a new tree' })).toHaveAttribute(
      'href',
      '/trees/new',
    );
    // No empty tree list or activity sections.
    expect(screen.queryByRole('heading', { name: 'Your trees' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Recent activity' })).toBeNull();
  });

  it('shows an alert on an error and reloads on Try again', async () => {
    const { auth, trees } = setup();
    trees.addTree({ name: 'Hale family' });
    trees.failNext('homeSummary', { code: 'NETWORK', message: MESSAGES.network });
    renderAt('/', { auth, trees });
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.network);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Hale family' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('restores a deleted tree and moves it to the main list', async () => {
    const { auth, trees } = setup();
    const id = trees.addTree({ name: 'Hale family' });
    await trees.deleteTree(id);
    renderAt('/', { auth, trees });
    const section = (await screen.findByRole('heading', { name: 'Deleted trees' })).closest(
      'section',
    )!;
    expect(within(section).getByText(/Hale family, can be restored until /)).toBeInTheDocument();
    // Only a deleted tree: not a first-time user, so no guide.
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('link', { name: 'Open Hale family' })).toHaveAttribute(
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

  it('shows the quota message when a restore would exceed the limit', async () => {
    const { auth, trees } = setup();
    const id = trees.addTree();
    await trees.deleteTree(id);
    trees.quotaLeft = 0;
    renderAt('/', { auth, trees });
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.quota);
  });

  it('signed out, goes to sign in and loads nothing', async () => {
    const trees = new FakeTreesApi();
    trees.addTree({ name: 'Hale family' });
    renderAt('/', { trees });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Hale family')).not.toBeInTheDocument();
    expect(trees.callsTo('homeSummary')).toHaveLength(0);
  });
});
