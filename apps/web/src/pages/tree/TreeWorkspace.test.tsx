import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES, toAuthError } from '../../auth/api';
import { LayoutTimeoutError } from '../../canvas/layout-engine';
import { haleGraph } from '../../canvas/test-fixtures';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

const hale = haleGraph();
const summaries = hale.persons.map(({ id, givenName, surname, birthYear, deathYear, isLiving }) =>
  fakePerson({ id, givenName, surname, birthYear, deathYear, isLiving, middleName: null }),
);
const lone = fakePerson({ id: 'lone', givenName: 'Lone', surname: 'Wolf' });
const viewerCaps = {
  editAnywhere: false,
  manageTree: false,
  invite: false,
  grantStewardship: false,
};

function setup(opts: { role?: 'owner' | 'viewer'; graph?: Partial<typeof hale> } = {}) {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
  const trees = new FakeTreesApi();
  const id = trees.addTree({
    name: 'Hale family',
    persons: [...summaries, lone],
    ...(opts.role === 'viewer' ? { role: 'viewer', detail: { capabilities: viewerCaps } } : {}),
  });
  const t = trees.trees.get(id)!;
  t.graph = { ...hale, mode: 'focus', focusId: 'robert', ...opts.graph };
  return { auth, trees, id, t };
}
const card = (name: string) => screen.findByRole('button', { name, hidden: true });
const ROBERT = 'Robert Hale, 1930–1998, deceased';
const DL = 'Relationship of David Hale and Laura Chen (Married)';
const graphCalls = (trees: FakeTreesApi) =>
  trees.callsTo('getGraph').map((c) => (c as { query: unknown }).query);

describe('TreeWorkspace', () => {
  it('loads the focus view around the root with no panel', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    expect(graphCalls(s.trees)[0]).toEqual({ mode: 'focus', focus: 'robert', depth: 1 });
    expect(
      screen.getByText('Select someone on the tree to see their details.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
  });

  it('opens a person, re-centres, and closes back to the focus', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    fireEvent.click(await card('David Hale, b. 1956'));
    expect(await screen.findByRole('complementary', { name: 'Details' })).toBeInTheDocument();
    await waitFor(() => expect(s.trees.callsTo('getPerson')).toHaveLength(1));
    await waitFor(() =>
      expect(graphCalls(s.trees)).toContainEqual({ mode: 'focus', focus: 'david', depth: 1 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull(),
    );
    expect(
      screen.getByText('Select someone on the tree to see their details.'),
    ).toBeInTheDocument();
  });

  it('switches to the full view and picks a branch', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    const full = screen.getByRole('button', { name: 'Full' });
    fireEvent.click(full);
    await waitFor(() => expect(full).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(graphCalls(s.trees)).toContainEqual({ mode: 'full' }));
    expect(screen.queryByLabelText('Generations')).toBeNull();
    const search = screen.getByLabelText('Show the branch of');
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.queryByRole('button', { name: 'Robert Hale 1930–1998' })).toBeNull();
    fireEvent.change(search, { target: { value: 'Rob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Robert Hale 1930–1998' }));
    await waitFor(() =>
      expect(graphCalls(s.trees)).toContainEqual({ mode: 'full', branch: 'robert' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Whole tree' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Whole tree' })).toBeNull());
  });

  it('changes the depth', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    fireEvent.change(screen.getByLabelText('Generations'), { target: { value: '2' } });
    await waitFor(() =>
      expect(graphCalls(s.trees)).toContainEqual({ mode: 'focus', focus: 'robert', depth: 2 }),
    );
  });

  it('asks for a branch when the tree is too big', async () => {
    const s = setup({
      graph: { needsBranch: true, total: 2500, persons: [], unions: [], links: [], mode: 'full' },
    });
    renderAt(`/trees/${s.id}?view=full`, s);
    expect(
      await screen.findByText(
        'This tree has 2,500 people, too many to draw at once. Choose a branch to show.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Show the branch of')).toBeInTheDocument();
    expect(screen.queryByRole('application', { name: 'Family tree' })).toBeNull();
  });

  it('says when only part of the tree is shown', async () => {
    const s = setup({ graph: { truncated: true } });
    renderAt(`/trees/${s.id}`, s);
    expect(
      await screen.findByText(
        'Only part of the tree is shown. Pick a branch or use the focus view to see the rest.',
      ),
    ).toBeInTheDocument();
  });

  it('shows layout failures, and opens the list on a timeout', async () => {
    const s = setup();
    const layout = new (await import('../../test/fake-layout')).FakeLayoutEngine();
    layout.failNext();
    renderAt(`/trees/${s.id}`, { ...s, layout });
    expect(await screen.findByText(MESSAGES.layoutFailed)).toBeInTheDocument();

    const s2 = setup();
    const layout2 = new (await import('../../test/fake-layout')).FakeLayoutEngine();
    layout2.failNext(new LayoutTimeoutError('slow'));
    renderAt(`/trees/${s2.id}`, { ...s2, layout: layout2 });
    expect(await screen.findAllByText(MESSAGES.layoutTooSlow)).not.toHaveLength(0);
    const summary = (await screen.findAllByText(/All people \(/)).at(-1)!;
    expect(summary.closest('details')).toHaveAttribute('open');
  });

  it('shows a graph error with a way back', async () => {
    const s = setup();
    s.trees.failNext('getGraph', toAuthError(404));
    renderAt(`/trees/${s.id}`, s);
    expect(await screen.findByText(toAuthError(404).message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the starting person' })).toHaveAttribute(
      'href',
      `/trees/${s.id}`,
    );
  });

  it('opens the union panel from a dot', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    fireEvent.click(await screen.findByRole('button', { name: DL, hidden: true }));
    expect(await screen.findByRole('button', { name: 'Edit relationship' })).toBeInTheDocument();
    expect(screen.getAllByText('David Hale and Laura Chen').length).toBeGreaterThan(0);
  });

  it('keeps focus in the union URL', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    fireEvent.click(await screen.findByRole('button', { name: DL, hidden: true }));
    await screen.findByRole('complementary', { name: 'Details' });
    // The focus stays on the root, so the graph is still asked for around Robert.
    expect(graphCalls(s.trees).at(-1)).toEqual({ mode: 'focus', focus: 'robert', depth: 1 });
  });

  it('lists disconnected people in a collapsed toggle', async () => {
    const s = setup();
    s.t.disconnected = [lone];
    renderAt(`/trees/${s.id}`, s);
    const toggle = await screen.findByRole('button', { name: 'Disconnected people (1)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(
      within(document.getElementById('disconnected-list')!).getByRole('link', {
        name: /Lone Wolf/,
      }),
    ).toHaveAttribute('href', `/trees/${s.id}/people/lone`);
  });

  it('has no disconnected toggle when there are none', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    expect(screen.queryByRole('button', { name: /Disconnected people/ })).toBeNull();
  });

  it('has the all-people fallback, keeping the full view in its links', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}?view=full`, s);
    const summary = await screen.findByText('All people (11)');
    const list = within(summary.closest('details')!);
    expect(list.getByRole('link', { name: /Robert Hale/ })).toHaveAttribute(
      'href',
      `/trees/${s.id}/people/robert?view=full`,
    );
    expect(screen.getByRole('link', { name: 'List of all people' })).toHaveAttribute(
      'href',
      '#people-fallback',
    );
  });

  it('shows toolbar links by role', async () => {
    const owner = setup();
    renderAt(`/trees/${owner.id}`, owner);
    expect(await screen.findByRole('link', { name: 'Add a person' })).toHaveAttribute(
      'href',
      `/trees/${owner.id}/people/new`,
    );
    expect(screen.getByRole('link', { name: 'Trash' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members and invites' })).toBeInTheDocument();
  });

  it('hides Add a person and Trash from viewers', async () => {
    const s = setup({ role: 'viewer' });
    renderAt(`/trees/${s.id}`, s);
    await screen.findByRole('link', { name: 'Members and invites' });
    expect(screen.queryByRole('link', { name: 'Add a person' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Trash' })).toBeNull();
  });

  it('refreshes the graph and disconnected list after a save in the panel', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/david`, s);
    const before = s.trees.callsTo('getGraph').length;
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    const first = screen.getByLabelText('First name');
    await waitFor(() => expect(s.trees.callsTo('listDisconnected').length).toBeGreaterThan(0));
    const disBefore = s.trees.callsTo('listDisconnected').length;
    fireEvent.change(first, { target: { value: 'Dave' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.trees.callsTo('getGraph').length).toBeGreaterThan(before));
    await waitFor(() =>
      expect(s.trees.callsTo('listDisconnected').length).toBeGreaterThan(disBefore),
    );
  });
});
