import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
/** A tree with neither your person nor a root: opening it selects no one. */
function unselected(s: ReturnType<typeof setup>) {
  s.t.detail.me.personId = null;
  s.t.detail.tree.rootPersonId = null;
  return s;
}
const card = (name: string) => screen.findByRole('button', { name, hidden: true });
const ROBERT = 'Robert Hale, 1930–1998, deceased';
const DL = 'Relationship of David Hale and Laura Chen (Married)';
const graphCalls = (trees: FakeTreesApi) =>
  trees.callsTo('getGraph').map((c) => (c as { query: unknown }).query);

describe('TreeWorkspace', () => {
  it('opening a tree selects your own person, keeping the view', async () => {
    const s = setup();
    s.t.detail.me.personId = 'david';
    const r = renderAt(`/trees/${s.id}?view=full`, s);
    await waitFor(() => expect(r.where()).toBe(`/trees/${s.id}/people/david?view=full`));
    const panel = screen.getByRole('complementary', { name: 'Details' });
    expect(
      await within(panel).findByRole('heading', { level: 2, name: /David Hale/ }),
    ).toBeInTheDocument();
    expect(within(panel).queryByText('Select someone on the tree.')).toBeNull();
    // An automatic choice moves no focus: the page's own Tab order starts at the header.
    expect(document.activeElement).toBe(document.body);
  });

  it('opening a tree without a person of your own selects the root', async () => {
    const s = setup();
    s.t.detail.me.personId = null;
    s.t.detail.tree.rootPersonId = 'robert';
    const r = renderAt(`/trees/${s.id}`, s);
    await waitFor(() => expect(r.where()).toBe(`/trees/${s.id}/people/robert`));
    expect(await screen.findByRole('heading', { level: 2, name: /Robert Hale/ })).toBeVisible();
    expect(graphCalls(s.trees).at(-1)).toEqual({ mode: 'focus', focus: 'robert', depth: 1 });
  });

  it('shows the hint when the tree has neither your person nor a root', async () => {
    const s = setup();
    s.t.detail.me.personId = null;
    s.t.detail.tree.rootPersonId = null;
    const r = renderAt(`/trees/${s.id}`, s);
    const panel = await screen.findByRole('complementary', { name: 'Details' });
    expect(await within(panel).findByText('Select someone on the tree.')).toBeInTheDocument();
    expect(
      screen.getByText('Select someone on the tree to see their details.'),
    ).toBeInTheDocument();
    expect(r.where()).toBe(`/trees/${s.id}`);
    expect(document.activeElement).toBe(document.body);
  });

  it('does not select again after the selection is cleared in the session', async () => {
    const s = setup();
    s.t.detail.tree.rootPersonId = 'robert';
    const r = renderAt(`/trees/${s.id}`, s);
    await waitFor(() => expect(r.where()).toBe(`/trees/${s.id}/people/robert`));
    act(() => void r.navigate(`/trees/${s.id}`));
    const panel = screen.getByRole('complementary', { name: 'Details' });
    expect(await within(panel).findByText('Select someone on the tree.')).toBeInTheDocument();
    expect(r.where()).toBe(`/trees/${s.id}`);
  });

  it('puts search before Focus | Full above the canvas, outside the panel', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    const search = screen.getByRole('searchbox', { name: 'Search' });
    // No visible label: a placeholder and a magnifier; the name stays "Search".
    expect(search).toHaveAttribute('placeholder', 'Search a person by name');
    expect(screen.getByText('Search', { selector: '.sr-only' })).toBeInTheDocument();
    const bar = screen.getByRole('group', { name: 'View' }).parentElement!;
    expect(bar).toContainElement(search);
    expect(screen.getByRole('complementary', { name: 'Details' })).not.toContainElement(search);
    expect(
      bar.compareDocumentPosition(screen.getByRole('region', { name: 'Family tree view' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('orders the side panel: generations, the person, sections, then the tree', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/david`, s);
    const panel = await screen.findByRole('complementary', { name: 'Details' });
    const heading = await within(panel).findByRole('heading', { level: 2, name: /David Hale/ });
    const order = [
      within(panel).getByLabelText('Generations'),
      heading,
      within(panel).getByRole('button', { name: /^Details/ }),
      within(panel).getByRole('button', { name: 'How are we related?' }),
      within(panel).getByRole('heading', { name: 'This tree' }),
      within(panel).getByRole('link', { name: 'Members and invites' }),
    ];
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    // The old Details toggle is gone: the only "Details" is the section row.
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(1);
  });

  it("tags the member's own person with their role and the root as the starting person", async () => {
    const s = setup();
    s.t.detail.me.personId = 'robert';
    const r = renderAt(`/trees/${s.id}/people/robert`, s);
    const h = await screen.findByRole('heading', { level: 2, name: /Robert Hale/ });
    expect(h).toHaveAccessibleName('Robert Hale 1930–1998 (Owner) (Starting person)');
    expect([...h.querySelectorAll('.name-tag')].map((t) => t.textContent)).toEqual([
      '(Owner)',
      '(Starting person)',
    ]);
    r.unmount();
    renderAt(`/trees/${s.id}/people/david`, s);
    const d = await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    expect(d.querySelector('.name-tag')).toBeNull();
  });

  it("shows a viewer's and an active steward's role on their own person", async () => {
    const s = setup({ role: 'viewer' });
    s.t.detail.me.personId = 'david';
    s.t.detail.me.steward = { grants: [], active: true };
    renderAt(`/trees/${s.id}/people/david`, s);
    const h = await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    expect(h).toHaveAccessibleName('David Hale b. 1956 (Viewer) (Steward)');
  });

  it('opens a person, re-centres, and closes the panel', async () => {
    const s = unselected(setup());
    renderAt(`/trees/${s.id}`, s);
    fireEvent.click(await card('David Hale, b. 1956'));
    expect(await screen.findByRole('complementary', { name: 'Details' })).toBeInTheDocument();
    await waitFor(() => expect(s.trees.callsTo('getPerson')).toHaveLength(1));
    await waitFor(() =>
      expect(graphCalls(s.trees)).toContainEqual({ mode: 'focus', focus: 'david', depth: 1 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse side panel' }));
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull(),
    );
  });

  it('switches to the full view and picks a branch', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    const view = screen.getByRole('group', { name: 'View' });
    const focus = within(view).getByRole('link', { name: 'Focus' });
    const full = within(view).getByRole('link', { name: 'Full' });
    expect(focus).toHaveAttribute('aria-current', 'true');
    expect(full).toHaveAttribute('href', `/trees/${s.id}?view=full`);
    fireEvent.click(full);
    await waitFor(() => expect(full).toHaveAttribute('aria-current', 'true'));
    expect(focus).not.toHaveAttribute('aria-current');
    expect(focus).toHaveAttribute('href', `/trees/${s.id}`);
    await waitFor(() => expect(graphCalls(s.trees)).toContainEqual({ mode: 'full' }));
    // The full view has no slider, and with no branch nothing at the top of the panel.
    expect(screen.queryByLabelText('Generations')).toBeNull();
    expect(screen.queryByLabelText('Show the branch of')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show whole tree' })).toBeNull();
  });

  it('a branch from the URL says whose it is, and the × shows the whole tree', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/david?view=full&branch=robert`, s);
    const panel = await screen.findByRole('complementary', { name: 'Details' });
    await within(panel).findByRole('heading', { level: 2, name: /David Hale/ });
    await waitFor(() =>
      expect(graphCalls(s.trees)).toContainEqual({ mode: 'full', branch: 'robert' }),
    );
    const status = panel.querySelector('[aria-live="polite"]')!;
    expect(status).toHaveTextContent('Showing Robert Hale’s branch');
    // Nothing in the panel sets a branch.
    expect(within(panel).queryByRole('link', { name: /branch/i })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Show whole tree' }));
    await waitFor(() => expect(r.where()).toBe(`/trees/${s.id}/people/david?view=full`));
    await waitFor(() => expect(graphCalls(s.trees).at(-1)).toEqual({ mode: 'full' }));
    expect(status).toHaveTextContent('');
    expect(within(panel).queryByRole('button', { name: 'Show whole tree' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Collapse side panel' })).toHaveFocus(),
    );
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
        'This tree has 2,500 people, too many to draw at once. Search for someone to see their place in the tree, or use the focus view.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
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
    const heading = await screen.findByRole('heading', { level: 2, name: /Lone Wolf/ });
    fireEvent.keyDown(heading, { key: 'Escape' });
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

describe('TreeWorkspace lineage', () => {
  const node = (id: string) =>
    document.querySelector(`.react-flow__node[data-id="p:${id}"]`) as HTMLElement | null;

  it("dims everyone off the selected person's direct line", async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/leo`, s);
    await waitFor(() => expect(node('mia')).toHaveClass('is-dim'));
    expect(node('leo')).toHaveClass('is-line');
    expect(node('david')).toHaveClass('is-line');
    expect(node('robert')).toHaveClass('is-line');
  });

  it('dims nothing while the panel is collapsed, or with nobody selected', async () => {
    const s = unselected(setup());
    renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    expect(document.querySelector('.react-flow__node.is-dim')).toBeNull();
  });

  it('removes the dimming when Escape collapses the panel', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/leo`, s);
    await waitFor(() => expect(node('mia')).toHaveClass('is-dim'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(node('mia')).not.toHaveClass('is-dim'));
    expect(document.querySelector('.react-flow__node.is-line')).toBeNull();
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

  const related = () => screen.findByRole('button', { name: 'How are we related?' });

  it('opens in a dialog from its side-panel row, with the selected person as To', async () => {
    const s = relSetup();
    const r = renderAt(`/trees/${s.id}/people/robert`, s);
    const row = await related();
    expect(row).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(row);
    const dialog = await screen.findByRole('dialog', { name: 'How are we related?' });
    expect(r.where()).toBe(`/trees/${s.id}/people/robert?tab=related&to=robert`);
    expect(await within(dialog).findByText('Robert Hale is your grandfather.')).toBeInTheDocument();
    // The X closes it, drops the pair and gives focus back to the row.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(r.where()).toBe(`/trees/${s.id}/people/robert`);
    expect(row).toHaveFocus();
  });

  it('leaves To empty when the selected person is you', async () => {
    const s = relSetup();
    const r = renderAt(`/trees/${s.id}/people/leo`, s);
    fireEvent.click(await related());
    const dialog = await screen.findByRole('dialog', { name: 'How are we related?' });
    expect(r.where()).toBe(`/trees/${s.id}/people/leo?tab=related`);
    expect(within(dialog).getByLabelText('To', { exact: true })).toHaveValue('');
  });

  it('opens with nothing selected too', async () => {
    const s = relSetup();
    renderAt(`/trees/${s.id}`, s);
    fireEvent.click(await related());
    expect(await screen.findByRole('dialog', { name: 'How are we related?' })).toBeInTheDocument();
  });

  it('redirects the old page to the dialog, keeping From and To', async () => {
    const s = relSetup();
    const r = renderAt(`/trees/${s.id}/relationship?from=leo&to=robert`, s);
    expect(await screen.findByRole('dialog', { name: 'How are we related?' })).toBeInTheDocument();
    expect(r.where()).toBe(`/trees/${s.id}?from=leo&to=robert&tab=related`);
  });

  it('shows the path on the tree: closes the dialog, close focus, highlighted people', async () => {
    const s = relSetup();
    const r = renderAt(`/trees/${s.id}?tab=related&to=robert`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Show on the tree' }));
    await waitFor(() =>
      expect(graphCalls(s.trees)).toContainEqual({ mode: 'focus', focus: 'leo', depth: 2 }),
    );
    await waitFor(() => expect(isPath().length).toBeGreaterThanOrEqual(3));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(r.where()).not.toMatch(/tab=/);
    // Collapsing the panel keeps the path drawn.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse side panel' }));
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull(),
    );
    expect(isPath().length).toBeGreaterThan(0);
    expect(r.where()).toMatch(/to=robert/);
  });

  it('switches to the full view for a long path', async () => {
    const s = relSetup(true);
    renderAt(`/trees/${s.id}?tab=related&from=leo&to=kid`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Show on the tree' }));
    await waitFor(() => expect(graphCalls(s.trees)).toContainEqual({ mode: 'full' }));
  });

  it('drops the highlight when the pair changes', async () => {
    const s = relSetup();
    renderAt(`/trees/${s.id}?tab=related&from=leo&to=robert`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Show on the tree' }));
    await waitFor(() => expect(isPath().length).toBeGreaterThan(0));
    fireEvent.click(await related());
    fireEvent.click(await screen.findByRole('button', { name: 'Change To' }));
    await waitFor(() => expect(isPath()).toHaveLength(0));
  });
});

describe('TreeWorkspace card menu (Task 11)', () => {
  const menuOf = async (name: string) => {
    fireEvent.contextMenu(await card(name));
    return screen.findByRole('menu', { name: /^Actions for / });
  };

  it('How are we related? opens the dialog with that person as To', async () => {
    const s = setup();
    s.t.detail.me.personId = 'leo';
    const r = renderAt(`/trees/${s.id}/people/leo`, s);
    const menu = await menuOf(ROBERT);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'How are we related?' }));
    expect(await screen.findByRole('dialog', { name: 'How are we related?' })).toBeInTheDocument();
    expect(r.where()).toBe(`/trees/${s.id}/people/robert?tab=related&to=robert`);
  });

  it('Focus on this person sets the focus view on them', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}?view=full`, s);
    const menu = await menuOf(ROBERT);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Focus on this person' }));
    await waitFor(() => expect(r.where()).toBe(`/trees/${s.id}/people/robert?focus=robert`));
  });

  it('Escape closes the menu but not the panel', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/david`, s);
    await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    const menu = await menuOf(ROBERT);
    fireEvent.keyDown(within(menu).getAllByRole('menuitem')[0]!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeInTheDocument();
  });
});

describe('TreeWorkspace collapsible panel (brief #15)', () => {
  const details = () => screen.queryByRole('complementary', { name: 'Details' });

  it('collapses and expands with one edge toggle that keeps the person and its own focus', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/david`, s);
    await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    const toggle = screen.getByRole('button', { name: 'Collapse side panel' });
    expect(toggle).toHaveAttribute('title', 'Collapse side panel');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'tree-panel');
    expect(toggle).toHaveClass('panel-toggle');
    // No X in the panel, and no avatar rail.
    expect(screen.queryByRole('button', { name: /^Collapse panel/ })).toBeNull();
    // Between the panel and the canvas in Tab order.
    const aside = screen.getByRole('complementary', { name: 'Details' });
    const canvas = screen.getByRole('region', { name: 'Family tree view' });
    expect(aside.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    toggle.focus();
    fireEvent.click(toggle);
    await waitFor(() => expect(details()).toBeNull());
    expect(r.where()).toMatch(/\/people\/david/);
    // The same button, now expanding; focus stays on it.
    expect(toggle).toHaveAccessibleName('Expand side panel');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(toggle.closest('.tree-workspace')).toHaveClass('is-collapsed');
    fireEvent.click(toggle);
    expect(await screen.findByRole('heading', { level: 2, name: /David Hale/ })).toBeVisible();
    expect(r.where()).toMatch(/\/people\/david/);
    expect(toggle).toHaveAccessibleName('Collapse side panel');
  });

  it('collapses and expands with nothing selected; expanding focuses its first control', async () => {
    const s = unselected(setup());
    const r = renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse side panel' }));
    await waitFor(() => expect(details()).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Expand side panel' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Generations')));
    expect(r.where()).toBe(`/trees/${s.id}`);
  });

  it('Escape does not collapse it when nothing is selected', async () => {
    const s = unselected(setup());
    renderAt(`/trees/${s.id}`, s);
    await card(ROBERT);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(details()).not.toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'Collapse side panel' }));
    await waitFor(() => expect(details()).toBeNull());
    fireEvent.click(await card(ROBERT));
    expect(await screen.findByRole('heading', { level: 2, name: /Robert Hale/ })).toBeVisible();
    expect(details()).not.toBeNull();
  });

  it('stays collapsed after a reload', async () => {
    const s = setup();
    const first = renderAt(`/trees/${s.id}/people/david`, s);
    await screen.findByRole('heading', { level: 2, name: /David Hale/ });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse side panel' }));
    await waitFor(() => expect(details()).toBeNull());
    first.unmount();
    renderAt(`/trees/${s.id}/people/david`, s);
    await card(ROBERT);
    expect(screen.getByRole('button', { name: 'Expand side panel' })).toBeInTheDocument();
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
});
