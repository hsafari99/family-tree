import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson, fakePersonView } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

const ada = fakePerson({ givenName: 'Ada', surname: 'King' });
const ann = fakePerson({ givenName: 'Ann', surname: 'Hale' });
const ben = fakePerson({ givenName: 'Ben', surname: 'Hale' });
const pat = fakePerson({ givenName: 'Pat', surname: 'Moss' });
const kit = fakePerson({ givenName: 'Kit', surname: 'King' });
const sib = fakePerson({ givenName: 'Sib', surname: 'King' });
const U1 = crypto.randomUUID();
const U2 = crypto.randomUUID();
const LINK = crypto.randomUUID();

function setup() {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
  const trees = new FakeTreesApi();
  const id = trees.addTree({ persons: [ada, ann, ben, pat, kit, sib].map((p) => ({ ...p })) });
  const view = fakePersonView(ada);
  Object.assign(view.relations, {
    parents: [
      {
        linkId: LINK,
        kind: 'biological',
        union: { id: U1, type: 'partnership', status: 'partners' },
        parents: [ann],
        moveTo: [{ unionId: U2, parents: [ann, ben] }],
      },
    ],
    unions: [
      {
        id: crypto.randomUUID(),
        type: 'marriage',
        status: 'married',
        startDate: null,
        endDate: null,
        partner: pat,
        children: [{ linkId: crypto.randomUUID(), kind: 'step', person: kit }],
      },
    ],
    siblings: [{ unionId: U1, kind: 'biological', person: sib }],
  });
  trees.trees.get(id)!.people.set(ada.id, view);
  return { auth, trees, id, view };
}
const open = (s: ReturnType<typeof setup>) =>
  renderAt(`/trees/${s.id}/people/${ada.id}?tab=relations`, s);

describe('RelationsTab (brief #12, #13)', () => {
  it('groups rows under headings, with exactly one menu per row and no loose actions', async () => {
    const s = setup();
    open(s);
    await screen.findByRole('heading', { name: 'Parents' });
    for (const h of ['Parents', 'Partners and children', 'Siblings']) {
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    }
    for (const li of within(screen.getByRole('list', { name: 'Parents' })).getAllByRole(
      'listitem',
    )) {
      expect(within(li).getAllByRole('button')).toHaveLength(1);
    }
    expect(screen.getAllByRole('button', { name: /^More actions for/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Move |^Remove|^Edit/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /^Link kind/ })).toBeNull();
    // The non-biological kind shows as a badge.
    expect(
      within(screen.getByRole('list', { name: 'Children with Pat Moss' })).getByText('Step'),
    ).toBeInTheDocument();
  });

  it('changes parents through the menu and the radio group', async () => {
    const s = setup();
    open(s);
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Ann Hale' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change parents…' }));
    const group = screen.getByRole('group', { name: 'Move Ada King to other parents' });
    const radio = within(group).getByRole('radio', { name: 'Ann Hale and Ben Hale' });
    expect(radio).toHaveFocus();
    fireEvent.click(radio);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(s.trees.callsTo('reparentLink')).toHaveLength(1));
    expect(s.trees.callsTo('reparentLink')[0]).toMatchObject({ linkId: LINK, unionId: U2 });
    expect(await screen.findByText('Parents changed.')).toBeInTheDocument();
  });

  it('offers no Change parents when there is nowhere to move', async () => {
    const s = setup();
    s.view.relations.parents[0]!.moveTo = [];
    open(s);
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Ann Hale' }));
    expect(screen.queryByRole('menuitem', { name: 'Change parents…' })).toBeNull();
  });

  it('opens the Add sibling form from the Add relative menu', async () => {
    const s = setup();
    open(s);
    fireEvent.click(await screen.findByRole('button', { name: 'Add relative' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Parent',
      'Child',
      'Partner',
      'Sibling',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sibling' }));
    expect(await screen.findByRole('form', { name: 'Add sibling' })).toBeInTheDocument();
  });

  it('changes a parent link kind through the menu', async () => {
    const s = setup();
    open(s);
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Ann Hale' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change link kind…' }));
    fireEvent.change(screen.getByLabelText('Link kind for Ann Hale'), {
      target: { value: 'adoptive' },
    });
    await waitFor(() => expect(s.trees.callsTo('updateParentChild')).toHaveLength(1));
    expect(s.trees.callsTo('updateParentChild')[0]).toMatchObject({
      linkId: LINK,
      input: { kind: 'adoptive' },
    });
  });

  it('Escape inside a menu closes the menu, not the panel', async () => {
    const s = setup();
    open(s);
    const trigger = await screen.findByRole('button', { name: 'More actions for Ann Hale' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('heading', { name: 'Parents' })).toBeInTheDocument();
  });
});

describe('RelationsTab partner order (brief #16)', () => {
  const sam = fakePerson({ givenName: 'Sam', surname: 'Ray' });
  function twoPartners() {
    const s = setup();
    s.trees.trees.get(s.id)!.persons.push({ ...sam });
    const first = s.view.relations.unions[0]!;
    s.view.relations.unions.push({ ...first, id: crypto.randomUUID(), partner: sam, children: [] });
    return { ...s, first: first.id, second: s.view.relations.unions[1]!.id };
  }
  const menu = (name: string) =>
    screen.findByRole('button', { name: `More actions for the relationship with ${name}` });
  const items = () => screen.getAllByRole('menuitem').map((m) => m.textContent);

  it('offers Move later on the first, Move earlier on the last, and Swap sides', async () => {
    const s = twoPartners();
    open(s);
    fireEvent.click(await menu('Pat Moss'));
    expect(items()).toContain('Move later');
    expect(items()).not.toContain('Move earlier');
    expect(items()).toContain('Swap sides on the tree');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(await menu('Sam Ray'));
    expect(items()).toContain('Move earlier');
    expect(items()).not.toContain('Move later');
  });

  it('saves the new order and swaps sides through the API', async () => {
    const s = twoPartners();
    open(s);
    fireEvent.click(await menu('Pat Moss'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move later' }));
    await waitFor(() => expect(s.trees.callsTo('reorderUnions')).toHaveLength(1));
    expect(s.trees.callsTo('reorderUnions')[0]).toMatchObject({
      personId: ada.id,
      unionIds: [s.second, s.first],
    });
    expect(await screen.findByText('Order saved.')).toBeInTheDocument();
    fireEvent.click(await menu('Sam Ray'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Swap sides on the tree' }));
    await waitFor(() => expect(s.trees.callsTo('swapPartners')).toHaveLength(1));
    expect(s.trees.callsTo('swapPartners')[0]).toMatchObject({ unionId: s.second });
    expect(await screen.findByText('Sides swapped.')).toBeInTheDocument();
  });

  it('has no Move items with one partner', async () => {
    const s = setup();
    open(s);
    fireEvent.click(await menu('Pat Moss'));
    expect(items()).not.toContain('Move later');
    expect(items()).toContain('Swap sides on the tree');
  });
});
