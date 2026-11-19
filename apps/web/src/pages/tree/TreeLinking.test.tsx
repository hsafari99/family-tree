import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { gl, gp, gu, haleGraph } from '../../canvas/test-fixtures';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson, fakePersonView } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

const hale = haleGraph();
const LINK = '11111111-1111-4111-8111-111111111111';
const CHEN = '22222222-2222-4222-8222-222222222222';

/** Hale family, with Laura's own family tree linked through her card. */
function setup() {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A' }, { signedIn: true });
  const trees = new FakeTreesApi();
  const id = trees.addTree({
    name: 'Hale family',
    persons: hale.persons.map((p) => fakePerson({ ...p })),
  });
  const t = trees.trees.get(id)!;
  t.graph = { ...hale, mode: 'full' };
  t.detail.me.personId = 'david';
  const papa = gp('papa', 'Papa', 1930, { surname: 'Chen', hasParents: false });
  trees.addLink(id, {
    id: LINK,
    otherTree: { id: CHEN, name: 'Chen family' },
    bridge: { userId: 'u-laura', name: 'Laura', personId: 'laura', otherPersonId: 'laura2' },
    otherPeopleCount: 2,
    graph: {
      tree: { id: CHEN, name: 'Chen family' },
      bridgePersonId: 'laura',
      graph: {
        mode: 'full',
        focusId: null,
        branchId: null,
        total: 2,
        truncated: false,
        needsBranch: false,
        persons: [papa, gp('mama', 'Mama', 1932, { surname: 'Chen', restricted: true })],
        unions: [gu('u-chen', 'papa', 'mama', { childCount: 1, canEdit: false })],
        links: [gl('l-laura', 'u-chen', 'laura')],
      },
    },
  });
  trees.linkedPeople.set(`${LINK}/papa`, {
    tree: { id: CHEN, name: 'Chen family' },
    view: fakePersonView(fakePerson({ id: 'papa', givenName: 'Papa', surname: 'Chen' }), {
      capabilities: { edit: false, addRelative: false, delete: false },
    }),
  });
  return { auth, trees, id };
}

describe('Tree linking on the canvas', () => {
  it('unfolds the linked tree from the bridge card and opens its people view-only', async () => {
    const s = setup();
    localStorage.clear();
    const r = renderAt(`/trees/${s.id}/people/david?view=full`, s);
    // The one-time notice.
    expect(await screen.findByText(/Now linked with the Chen family tree/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: now linked with Chen family' }));
    expect(screen.queryByText(/Now linked with the Chen family tree/)).toBeNull();

    const marker = await screen.findByRole('button', {
      name: 'Show Chen family, 2 people',
      hidden: true,
    });
    expect(marker).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(marker);
    const papa = await screen.findByRole('button', {
      name: /^Papa Chen, b. 1930, in Chen family, view only/,
      hidden: true,
    });
    expect(s.trees.callsTo('linkedGraph')).toHaveLength(1);
    // Read-only: no "+" buttons on a linked card.
    expect(
      screen.queryByRole('button', { name: 'Add a parent of Papa Chen', hidden: true }),
    ).toBeNull();

    fireEvent.click(papa);
    await waitFor(() => expect(r.where()).toContain(`/people/papa?view=full&linked=${LINK}`));
    const panel = screen.getByRole('complementary', { name: 'Details' });
    expect(await within(panel).findByRole('heading', { name: /Papa Chen/ })).toBeInTheDocument();
    expect(within(panel).getByText('View only')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /History/ })).toBeNull();
    // The own tree's view never asked for a linked person.
    expect(
      s.trees
        .callsTo('getGraph')
        .every((c) => (c as { query: { focus?: string } }).query.focus !== 'papa'),
    ).toBe(true);

    // Folding remembers itself.
    fireEvent.click(screen.getByRole('button', { name: 'Fold away Chen family', hidden: true }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /^Papa Chen, b. 1930/, hidden: true }),
      ).toBeNull(),
    );
  });

  it('lists matches in linked trees in their own search group', async () => {
    const s = setup();
    s.trees.linkedSearch.set(s.id, [
      {
        ...fakePerson({ id: 'papa', givenName: 'Papa', surname: 'Chen' }),
        photoThumbUrl: null,
        relation: null,
        linkId: LINK,
        treeId: CHEN,
        treeName: 'Chen family',
      },
    ]);
    const r = renderAt(`/trees/${s.id}/people/david?view=full`, s);
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'papa' } });
    const group = await screen.findByRole('list', { name: 'Search results in linked trees' });
    fireEvent.click(within(group).getByRole('button', { name: /Papa Chen/ }));
    await waitFor(() => expect(r.where()).toContain(`linked=${LINK}`));
    expect(
      await screen.findByRole('button', { name: /^Papa Chen, b. 1930/, hidden: true }),
    ).toBeTruthy();
  });
});

describe('Linked trees in the Members dialog', () => {
  it('lets the owner accept a request and end a link', async () => {
    const s = setup();
    const pending = s.trees.addLink(s.id, {
      status: 'pending',
      otherTree: { id: '33333333-3333-4333-8333-333333333333', name: 'Berg family' },
      acceptedHere: false,
      acceptedThere: true,
      canAccept: true,
      canEnd: true,
    });
    s.trees.links.get(s.id)![0]!.canEnd = true;
    renderAt(`/trees/${s.id}/members`, s);
    const section = await screen.findByRole('region', { name: 'Linked trees' });
    expect(await within(section).findByText('Chen family')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Accept' }));
    expect(await within(section).findByText('Linked with Berg family.')).toBeInTheDocument();
    expect(s.trees.callsTo('acceptLink')).toEqual([{ treeId: s.id, linkId: pending }]);

    fireEvent.click(within(section).getAllByRole('button', { name: 'End link' })[0]!);
    fireEvent.click(within(section).getByRole('button', { name: 'End the link with Chen family' }));
    expect(
      await within(section).findByText(/The link with Chen family has ended/),
    ).toBeInTheDocument();
  });

  it('proposes a link with another tree the member has a card in', async () => {
    const s = setup();
    s.trees.candidates.set(s.id, [
      { treeId: '44444444-4444-4444-8444-444444444444', name: 'My own tree', peopleCount: 5 },
    ]);
    renderAt(`/trees/${s.id}/members`, s);
    const section = await screen.findByRole('region', { name: 'Linked trees' });
    fireEvent.click(
      await within(section).findByRole('button', { name: 'Link with another tree I’m in' }),
    );
    fireEvent.change(within(section).getByLabelText('Tree to link with'), {
      target: { value: '44444444-4444-4444-8444-444444444444' },
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Send request' }));
    expect(await within(section).findByText(/Request sent/)).toBeInTheDocument();
    expect(within(section).getByText(/Waiting for this tree’s owner/)).toBeInTheDocument();
  });
});

describe('Link requests on the Home page', () => {
  it('shows a waiting request with Accept and Decline', async () => {
    const s = setup();
    s.trees.requests = [
      {
        linkId: LINK,
        treeId: s.id,
        treeName: 'Hale family',
        otherTreeName: 'Chen family',
        bridgeName: 'Laura',
        otherPeopleCount: 2,
      },
    ];
    renderAt('/', s);
    const card = await screen.findByRole('region', { name: 'Link requests' });
    expect(within(card).getByText(/Laura wants to link/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Decline' }));
    expect(await within(card).findByText('Request declined.')).toBeInTheDocument();
    expect(s.trees.callsTo('declineLink')).toEqual([{ treeId: s.id, linkId: LINK }]);
  });
});
