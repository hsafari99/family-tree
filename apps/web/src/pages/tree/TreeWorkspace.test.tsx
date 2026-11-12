import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES, toAuthError } from '../../auth/api';
import { LayoutTimeoutError } from '../../canvas/layout-engine';
import { gp, gu, haleGraph } from '../../canvas/test-fixtures';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson, fakePersonView } from '../../test/fake-trees';
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
    persons: [...summaries, lone].map((p) => ({ ...p })),
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

  it('opens a person, re-centres, and closes the panel', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    fireEvent.click(await card('David Hale, b. 1956'));
    expect(await screen.findByRole('complementary', { name: 'Details' })).toBeInTheDocument();
    await waitFor(() => expect(s.trees.callsTo('getPerson')).toHaveLength(1));
    await waitFor(() =>
      expect(graphCalls(s.trees)).toContainEqual({ mode: 'focus', focus: 'david', depth: 1 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull(),
    );
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
    const skip = screen.getByRole('link', { name: 'List of all people' });
    expect(skip).toHaveAttribute('href', '#people-fallback');
    const details = summary.closest('details')!;
    expect(details).toHaveAttribute('id', 'people-fallback');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(skip);
    expect(details).toHaveAttribute('open');
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
    renderAt(`/trees/${s.id}/people/david?tab=info`, s);
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

describe('TreeWorkspace add from a card', () => {
  it('opens the child form with the partner preselected (what a card "+" does)', async () => {
    const s = setup();
    const laura = summaries.find((p) => p.id === 'laura')!;
    const david = summaries.find((p) => p.id === 'david')!;
    s.t.people.set(
      'laura',
      fakePersonView(laura, {
        relations: {
          parents: [],
          siblings: [],
          unions: [
            {
              id: 'u-dl',
              type: 'marriage',
              status: 'married',
              startDate: null,
              endDate: null,
              partner: david,
              children: [],
            },
          ],
        },
      }),
    );
    renderAt(`/trees/${s.id}/people/laura?tab=relations&add=child`, s);
    expect(await screen.findByLabelText('Other parent')).toHaveDisplayValue('with David Hale');
  });
});

describe('TreeWorkspace panel focus and keys', () => {
  it('moves focus to the panel heading, and Escape closes and returns focus to the card', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    const card = await screen.findByRole('button', { name: 'David Hale, b. 1956', hidden: true });
    fireEvent.click(card);
    const heading = await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    fireEvent.keyDown(heading, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'David Hale, b. 1956', hidden: true }),
      ),
    );
  });

  it('focuses the canvas when the selected card is not rendered', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/lone`, s);
    await screen.findByRole('complementary', { name: 'Details' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Family tree view' })),
    );
  });

  it('announces the branch prompt as a status and allows the deepest depth', async () => {
    const s = setup({
      graph: { needsBranch: true, total: 2500, persons: [], unions: [], links: [], mode: 'full' },
    });
    renderAt(`/trees/${s.id}?view=full`, s);
    const msg = await screen.findByText(/too many to draw at once/);
    expect(msg).toHaveAttribute('role', 'status');
    const s2 = setup();
    renderAt(`/trees/${s2.id}`, s2);
    expect(await screen.findByLabelText('Generations')).toHaveAttribute('max', '3');
  });
});

describe('TreeWorkspace relationships', () => {
  const SEX = {
    robert: 'male',
    margaret: 'female',
    david: 'male',
    susan: 'female',
    leo: 'male',
  } as const;
  function relSetup(extend = false) {
    const s = setup();
    const persons: typeof hale.persons = hale.persons.map((p) => ({
      ...p,
      sex: (SEX as Record<string, 'male' | 'female'>)[p.id] ?? p.sex,
    }));
    const unions = [...hale.unions];
    const links = [...hale.links];
    if (extend) {
      persons.push(gp('kid', 'Kit', 2020, { hasParents: true }));
      unions.push(
        gu('u-n', 'noah', null, { type: 'partnership', status: 'partners', childCount: 1 }),
      );
      links.push({ id: 'l-kid', unionId: 'u-n', childId: 'kid', kind: 'biological' });
    }
    s.t.graph = { ...hale, persons, unions, links, mode: 'focus', focusId: 'robert' };
    if (extend)
      s.t.persons.push(
        fakePerson({ id: 'kid', givenName: 'Kit', surname: 'Hale', birthYear: 2020 }),
      );
    s.t.detail.me.personId = 'leo';
    return s;
  }
  const isPath = () => document.querySelectorAll('.react-flow__node.is-path');

  it('opens the panel from the toolbar link with the selected person', async () => {
    const s = relSetup();
    renderAt(`/trees/${s.id}/people/robert`, s);
    const link = await screen.findByRole('link', { name: 'How are we related?' });
    expect(link).toHaveAttribute('href', `/trees/${s.id}/relationship?to=robert`);
    fireEvent.click(link);
    expect(await screen.findByText('Robert Hale is your grandfather.')).toBeInTheDocument();
  });

  it('shows the path on the tree: close focus, highlighted people', async () => {
    const s = relSetup();
    renderAt(`/trees/${s.id}/relationship?to=robert`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Show on the tree' }));
    await waitFor(() =>
      expect(graphCalls(s.trees)).toContainEqual({ mode: 'focus', focus: 'leo', depth: 2 }),
    );
    await waitFor(() => expect(isPath().length).toBeGreaterThanOrEqual(3));
  });

  it('switches to the full view for a long path', async () => {
    const s = relSetup(true);
    renderAt(`/trees/${s.id}/relationship?from=leo&to=kid`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Show on the tree' }));
    await waitFor(() => expect(graphCalls(s.trees)).toContainEqual({ mode: 'full' }));
  });

  it('Close collapses the panel and keeps the path on the tree', async () => {
    const s = relSetup();
    const r = renderAt(`/trees/${s.id}/relationship?from=leo&to=robert`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Show on the tree' }));
    await waitFor(() => expect(isPath().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull(),
    );
    expect(isPath().length).toBeGreaterThan(0);
    expect(r.where()).toMatch(/from=leo&to=robert/);
  });

  it('drops the highlight when To changes', async () => {
    const s = relSetup();
    renderAt(`/trees/${s.id}/relationship?from=leo&to=robert`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Show on the tree' }));
    await waitFor(() => expect(isPath().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Change To' }));
    await waitFor(() => expect(isPath()).toHaveLength(0));
  });

  it('keeps to when "How are we related?" is clicked on the relationship page', async () => {
    const s = relSetup();
    renderAt(`/trees/${s.id}/relationship?from=leo&to=robert`, s);
    const link = await screen.findByRole('link', { name: 'How are we related?' });
    expect(link.getAttribute('href')).toContain('to=robert');
  });
});

describe('TreeWorkspace collapsible panel (brief #15)', () => {
  const details = () => screen.queryByRole('complementary', { name: 'Details' });
  const toggle = () => screen.getByRole('button', { name: 'Details' });

  it('Close hides the panel, keeps the person in the URL, and Details shows it again', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/david`, s);
    await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(toggle()).toHaveAttribute('aria-controls', 'tree-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    await waitFor(() => expect(details()).toBeNull());
    expect(r.where()).toMatch(/\/people\/david/);
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle());
    expect(await screen.findByRole('complementary', { name: 'Details' })).toBeInTheDocument();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    // The toggle collapses it too.
    fireEvent.click(toggle());
    await waitFor(() => expect(details()).toBeNull());
  });

  it('collapses with the X to a rail whose Expand button brings the same person back', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/david`, s);
    await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    const x = screen.getByRole('button', { name: 'Collapse panel' });
    expect(x).toHaveAttribute('title', 'Collapse panel');
    expect(x).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: /Expand panel/ })).toBeNull();
    fireEvent.click(x);
    await waitFor(() => expect(details()).toBeNull());
    const expand = screen.getByRole('button', { name: /Expand panel/ });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(expand).toHaveAttribute('aria-controls', 'tree-panel');
    // The rail shows who it brings back (initials when there's no photo to hand).
    expect(expand).toHaveTextContent('DH');
    fireEvent.click(expand);
    expect(await screen.findByRole('heading', { level: 2, name: /David Hale/ })).toBeVisible();
    expect(r.where()).toMatch(/\/people\/david/);
    expect(screen.queryByRole('button', { name: /Expand panel/ })).toBeNull();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the rail with nothing selected, and it opens the root person', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    fireEvent.click(screen.getByRole('button', { name: /Expand panel/ }));
    expect(await screen.findByRole('heading', { level: 2, name: /Robert Hale/ })).toBeVisible();
    expect(r.where()).toMatch(/\/people\/robert/);
  });

  it('Escape in a section dialog closes the dialog, not the panel', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/david?tab=places`, s);
    const dialog = await screen.findByRole('dialog', { name: 'Places — David Hale' });
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Close' }), { key: 'Escape' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(details()).not.toBeNull();
    expect(r.where()).not.toMatch(/tab=/);
  });

  it('Escape collapses, but not from a field', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/david`, s);
    const heading = await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    const field = document.createElement('input');
    heading.after(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(details()).not.toBeNull();
    fireEvent.keyDown(heading, { key: 'Escape' });
    await waitFor(() => expect(details()).toBeNull());
    expect(r.where()).toMatch(/\/people\/david/);
  });

  it('expands when another card is clicked', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/david`, s);
    await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    await waitFor(() => expect(details()).toBeNull());
    fireEvent.click(await card(ROBERT));
    expect(await screen.findByRole('heading', { level: 2, name: /Robert Hale/ })).toBeVisible();
    expect(details()).not.toBeNull();
  });

  it('stays collapsed after a reload', async () => {
    const s = setup();
    const first = renderAt(`/trees/${s.id}/people/david`, s);
    await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }));
    await waitFor(() => expect(details()).toBeNull());
    first.unmount();
    renderAt(`/trees/${s.id}/people/david`, s);
    await card(ROBERT);
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(details()).toBeNull();
  });

  it('comes before the canvas, so Tab reaches it first', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/david`, s);
    const aside = await screen.findByRole('complementary', { name: 'Details' });
    const canvas = screen.getByRole('region', { name: 'Family tree view' });
    expect(aside.id).toBe('tree-panel');
    expect(aside.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the root person when nothing is selected or was opened', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle());
    expect(await screen.findByRole('heading', { level: 2, name: /Robert Hale/ })).toBeVisible();
    expect(r.where()).toMatch(/\/people\/robert/);
  });
});
