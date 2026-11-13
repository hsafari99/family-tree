import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { haleGraph } from '../../canvas/test-fixtures';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

// Linking people to accounts: invites from a person, "This is me", and who's linked.

const hale = haleGraph();
const summaries = hale.persons.map(({ id, givenName, surname, birthYear, deathYear, isLiving }) =>
  fakePerson({ id, givenName, surname, birthYear, deathYear, isLiving, middleName: null }),
);
const caps = (over: Partial<Record<string, boolean>> = {}) => ({
  editAnywhere: true,
  manageTree: true,
  invite: true,
  grantStewardship: true,
  ...over,
});

function setup(
  opts: {
    role?: 'owner' | 'editor' | 'viewer';
    capabilities?: ReturnType<typeof caps>;
    me?: string | null;
  } = {},
) {
  const auth = new FakeAuthApi();
  const user = auth.addUser(
    { email: 'a@example.com', name: 'A', twoFactorEnabled: true },
    { signedIn: true },
  );
  const trees = new FakeTreesApi();
  trees.meUserId = user.id;
  const id = trees.addTree({
    name: 'Hale family',
    role: opts.role ?? 'owner',
    persons: summaries.map((p) => ({ ...p })),
    detail: { capabilities: opts.capabilities ?? caps() },
  });
  const t = trees.trees.get(id)!;
  t.detail.me.personId = opts.me === undefined ? 'robert' : opts.me;
  t.detail.tree.rootPersonId = 'robert';
  t.graph = { ...hale, mode: 'focus', focusId: 'robert' };
  return { auth, trees, id, t, user };
}

const panel = () => screen.getByRole('complementary', { name: 'Details' });
const heading = async (name: RegExp) =>
  within(await screen.findByRole('complementary', { name: 'Details' })).findByRole('heading', {
    level: 2,
    name,
  });
const cardOf = async (name: string) =>
  (await screen.findAllByRole('button', { name: new RegExp(`^${name}\\b`), hidden: true }))[0]!;

describe('who is linked', () => {
  it('marks a card linked to another member and says so in the panel', async () => {
    const s = setup();
    s.t.detail.linkedMembers = [
      { personId: 'robert', name: 'A' },
      { personId: 'david', name: 'Dana' },
    ];
    renderAt(`/trees/${s.id}/people/david`, s);
    await heading(/David Hale/);
    expect(await within(panel()).findByText(/Linked to Dana’s account/)).toBeInTheDocument();
    // A linked person can't be invited or claimed.
    expect(within(panel()).queryByRole('button', { name: /^Invite / })).toBeNull();
    const david = await cardOf('David Hale');
    expect(david).toHaveAccessibleName(/, linked to Dana$/);
    const badge = screen.getByRole('img', { name: 'Linked to Dana', hidden: true });
    expect(badge).toHaveAttribute('title', 'Linked to Dana');
    // Your own card says "You", not a link badge.
    expect(screen.queryByRole('img', { name: 'Linked to A', hidden: true })).toBeNull();
  });

  it('says nothing about accounts on your own card', async () => {
    const s = setup();
    s.t.detail.linkedMembers = [{ personId: 'robert', name: 'A' }];
    renderAt(`/trees/${s.id}/people/robert`, s);
    await heading(/Robert Hale/);
    expect(within(panel()).queryByText(/Linked to/)).toBeNull();
    expect(within(panel()).queryByRole('button', { name: 'This is me' })).toBeNull();
  });
});

describe('invite from a person', () => {
  it('from the panel: a steward invite for their branch by default, and the link to copy', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/laura`, s);
    await heading(/Laura Chen/);
    fireEvent.click(await within(panel()).findByRole('button', { name: 'Invite Laura…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite Laura Chen' });
    expect(r.where()).toBe(`/trees/${s.id}/people/laura?tab=invite`);
    expect(within(dialog).getByRole('radio', { name: 'Steward of Laura’s branch' })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create invite link' }));
    await waitFor(() =>
      expect(s.trees.callsTo('createInvite')).toEqual([
        {
          treeId: s.id,
          input: { role: 'viewer', stewardAnchorPersonId: 'laura', targetPersonId: 'laura' },
        },
      ]),
    );
    expect(await within(dialog).findByLabelText('Invite link')).toHaveValue(
      `${window.location.origin}/invite/fake-token-1`,
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(panel()).findByText('Invite pending')).toBeInTheDocument();
    // Focus comes back to the panel's invite button.
    await waitFor(() =>
      expect(within(panel()).getByRole('button', { name: 'View invite…' })).toHaveFocus(),
    );
  });

  it('defaults to Can add and edit, with no steward choice, without grantStewardship', async () => {
    const s = setup({ capabilities: caps({ grantStewardship: false }) });
    renderAt(`/trees/${s.id}/people/laura?tab=invite`, s);
    const dialog = await screen.findByRole('dialog', { name: 'Invite Laura Chen' });
    expect(within(dialog).getByRole('radio', { name: 'Can add and edit' })).toBeChecked();
    expect(within(dialog).queryByRole('radio', { name: /^Steward/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Can view' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create invite link' }));
    await waitFor(() =>
      expect(s.trees.callsTo('createInvite')).toEqual([
        {
          treeId: s.id,
          input: { role: 'viewer', stewardAnchorPersonId: null, targetPersonId: 'laura' },
        },
      ]),
    );
  });

  it('shows an open invite instead of a new one, which can be revoked', async () => {
    const s = setup();
    s.t.invites.push({
      id: crypto.randomUUID(),
      role: 'editor',
      stewardAnchorPersonId: null,
      targetPersonId: 'laura',
      createdByUserId: s.user.id,
      createdByName: 'A',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    renderAt(`/trees/${s.id}/people/laura`, s);
    await heading(/Laura Chen/);
    expect(await within(panel()).findByText('Invite pending')).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'View invite…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite Laura Chen' });
    const list = within(dialog).getByRole('list', { name: 'Open invites for Laura Chen' });
    expect(list).toHaveTextContent('Can add and edit, for Laura Chen, created by A');
    fireEvent.click(within(list).getByRole('button', { name: 'Revoke' }));
    fireEvent.click(within(list).getByRole('button', { name: 'Revoke invite' }));
    expect(
      await within(dialog).findByRole('button', { name: 'Create invite link' }),
    ).toBeInTheDocument();
    expect(s.trees.callsTo('revokeInvite')).toHaveLength(1);
  });

  it('from the card menu: opens the invite dialog on that person', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/robert`, s);
    await heading(/Robert Hale/);
    fireEvent.contextMenu(await cardOf('David Hale'));
    const menu = await screen.findByRole('menu', { name: 'Actions for David Hale' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Invite David…' }));
    expect(await screen.findByRole('dialog', { name: 'Invite David Hale' })).toBeInTheDocument();
    expect(r.where()).toBe(`/trees/${s.id}/people/david?tab=invite`);
  });

  it('offers no invite to a member who may not invite, and on your own card', async () => {
    const s = setup({ role: 'editor', capabilities: caps({ manageTree: false, invite: false }) });
    const r = renderAt(`/trees/${s.id}/people/laura?tab=invite`, s);
    await heading(/Laura Chen/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(panel()).queryByRole('button', { name: /^Invite / })).toBeNull();
    fireEvent.contextMenu(await cardOf('David Hale'));
    const menu = await screen.findByRole('menu', { name: 'Actions for David Hale' });
    expect(within(menu).queryByRole('menuitem', { name: /^Invite/ })).toBeNull();
    expect(r.where()).toContain('/people/laura');
  });
});

describe('This is me', () => {
  it('links an unlinked member to the person after confirming, then marks the card You', async () => {
    const s = setup({
      role: 'viewer',
      capabilities: caps({
        editAnywhere: false,
        manageTree: false,
        invite: false,
        grantStewardship: false,
      }),
      me: null,
    });
    renderAt(`/trees/${s.id}/people/laura`, s);
    await heading(/Laura Chen/);
    fireEvent.click(await within(panel()).findByRole('button', { name: 'This is me' }));
    const dialog = await screen.findByRole('dialog', { name: 'Are you Laura Chen?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, this is me' }));
    await waitFor(() =>
      expect(s.trees.callsTo('claimPerson')).toEqual([{ treeId: s.id, personId: 'laura' }]),
    );
    expect(await heading(/Laura Chen.*\(Viewer\)/)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(panel()).queryByRole('button', { name: 'This is me' })).toBeNull(),
    );
    expect(await cardOf('Laura Chen')).toHaveAccessibleName(/, you$/);
  });

  it('shows the server’s reason when the person was claimed meanwhile', async () => {
    const s = setup({ me: null });
    s.trees.failNext('claimPerson', {
      code: 'PERSON_CLAIMED',
      message: 'Someone else in this tree is already linked to that person',
    });
    renderAt(`/trees/${s.id}/people/laura`, s);
    await heading(/Laura Chen/);
    fireEvent.click(await within(panel()).findByRole('button', { name: 'This is me' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, this is me' }));
    expect(await within(panel()).findByRole('alert')).toHaveTextContent(
      'Someone else in this tree is already linked to that person',
    );
  });

  it('is not offered once you have a card', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/laura`, s);
    await heading(/Laura Chen/);
    expect(within(panel()).queryByRole('button', { name: 'This is me' })).toBeNull();
  });
});

describe('Which one is you?', () => {
  const banner = () => screen.queryByText(/Which one is you\?/);

  it('asks an unlinked member, and stays dismissed for that tree', async () => {
    const s = setup({ me: null });
    const r = renderAt(`/trees/${s.id}`, s);
    expect(await screen.findByText(/Which one is you\? Open your card/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: which one is you?' }));
    expect(banner()).toBeNull();
    r.unmount();
    renderAt(`/trees/${s.id}`, s);
    await heading(/Robert Hale/);
    expect(banner()).toBeNull();
  });

  it('is not shown to a member who has a card', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    await heading(/Robert Hale/);
    expect(banner()).toBeNull();
  });
});
