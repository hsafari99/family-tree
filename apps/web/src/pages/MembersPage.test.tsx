import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeTreesApi, fakePerson } from '../test/fake-trees';
import { renderAt } from '../test/render';

const ada = fakePerson({ givenName: 'Ada', surname: 'Hale' });
const bob = fakePerson({ givenName: 'Bob', surname: 'Hale' });
const cy = fakePerson({ givenName: 'Cy', surname: 'Hale' });
const dee = fakePerson({ givenName: 'Dee', surname: 'Hale' });

const caps = (over: Partial<Record<string, boolean>> = {}) => ({
  editAnywhere: false,
  manageTree: false,
  invite: false,
  grantStewardship: false,
  ...over,
});

function member(
  over: { userId?: string; name: string; role: 'owner' | 'editor' | 'viewer' } & Record<
    string,
    unknown
  >,
) {
  return {
    userId: crypto.randomUUID(),
    personId: null,
    invitedByUserId: null,
    joinedAt: '2026-03-04T12:00:00.000Z',
    ...over,
  };
}

/** A signed-in user (`me`) looking at a tree seeded as the given role. */
function setup(kind: 'owner' | 'editor' | 'steward' = 'owner') {
  const auth = new FakeAuthApi();
  const user = auth.addUser(
    { email: 'me@example.com', name: 'Me', twoFactorEnabled: true },
    { signedIn: true },
  );
  const trees = new FakeTreesApi();
  trees.meUserId = user.id;
  const emails = kind === 'owner';
  const mine = member({
    userId: user.id,
    name: 'Me',
    role: kind === 'owner' ? 'owner' : kind === 'editor' ? 'editor' : 'viewer',
    ...(emails ? { email: 'me@example.com', twoFactorEnabled: true } : {}),
  });
  const invitedByMe = member({
    name: 'Invited By Me',
    role: 'viewer',
    invitedByUserId: user.id,
    ...(emails ? { email: 'a@example.com', twoFactorEnabled: false } : {}),
  });
  const other = member({
    name: 'Other Person',
    role: 'editor',
    ...(emails ? { email: 'b@example.com', twoFactorEnabled: true } : {}),
  });
  const detail =
    kind === 'owner'
      ? {
          capabilities: caps({
            editAnywhere: true,
            manageTree: true,
            invite: true,
            grantStewardship: true,
          }),
        }
      : kind === 'editor'
        ? { capabilities: caps({ editAnywhere: true }) }
        : {
            capabilities: caps({ invite: true, grantStewardship: true }),
            me: {
              role: 'viewer' as const,
              personId: null,
              steward: {
                grants: [{ id: crypto.randomUUID(), anchorPersonId: bob.id }],
                active: true,
              },
            },
          };
  const id = trees.addTree({
    name: 'Hale family',
    role: kind === 'steward' ? 'viewer' : kind,
    persons: [ada, bob, cy, dee],
    members: [mine, invitedByMe, other],
    detail,
  });
  return { auth, trees, id, user, mine, invitedByMe, other };
}

const rowOf = (name: string) => screen.getByText(name, { selector: '.member-name' }).closest('tr')!;

/** Opens a row's "More actions" menu and picks an item. */
function pick(row: HTMLElement, name: string, item: string) {
  fireEvent.click(within(row).getByRole('button', { name: `More actions for ${name}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MembersPage', () => {
  it('owner: shows emails and role selects, changes a role, removes after confirming', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Members and invites' }),
    ).toBeInTheDocument();
    // One level up is the tree: an icon link before the title, and the header names the tree.
    expect(await screen.findByRole('link', { name: 'Back to Hale family' })).toHaveAttribute(
      'href',
      `/trees/${s.id}`,
    );
    expect(
      await within(screen.getByRole('banner')).findByRole('link', { name: 'Hale family' }),
    ).toHaveAttribute('href', `/trees/${s.id}`);
    expect(await screen.findByText('a@example.com')).toBeInTheDocument();
    expect(within(rowOf('Me')).getByText('You')).toHaveClass('badge');
    expect(screen.queryByLabelText('Role for Me')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role for Invited By Me'), {
      target: { value: 'editor' },
    });
    await waitFor(() =>
      expect(s.trees.callsTo('changeRole')).toEqual([
        { treeId: s.id, userId: s.invitedByMe.userId, role: 'editor' },
      ]),
    );
    const row = rowOf('Invited By Me');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(s.trees.callsTo('removeMember')).toHaveLength(0);
    fireEvent.click(within(row).getByRole('button', { name: 'Remove from tree' }));
    await waitFor(() => expect(s.trees.callsTo('removeMember')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Invited By Me')).not.toBeInTheDocument());
  });

  it('says "their own branch" when the steward’s branch starts at their own card', async () => {
    const s = setup();
    const t = s.trees.trees.get(s.id)!;
    t.members = t.members.map((m) =>
      m.userId === s.other.userId ? { ...m, personId: bob.id } : m,
    );
    t.stewards.push({
      id: crypto.randomUUID(),
      userId: s.other.userId,
      userName: 'Other Person',
      anchorPersonId: bob.id,
      grantedByUserId: s.user.id,
      grantedByName: 'Me',
      parentGrantId: null,
      active: false,
    });
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    const scope = within(rowOf('Other Person')).getAllByRole('cell')[2]!;
    expect(scope).toHaveTextContent('Steward of their own branch (waiting for 2FA)');
    expect(scope).not.toHaveTextContent('Bob Hale’s branch');
  });

  it('is a real table: five headers, five cells per row, each labelled (brief #19)', async () => {
    const s = setup();
    const t = s.trees.trees.get(s.id)!;
    t.members = t.members.map((m) =>
      m.userId === s.other.userId ? { ...m, personId: dee.id } : m,
    );
    t.stewards.push(
      {
        id: crypto.randomUUID(),
        userId: s.other.userId,
        userName: 'Other Person',
        anchorPersonId: bob.id,
        grantedByUserId: s.user.id,
        grantedByName: 'Me',
        parentGrantId: null,
        active: true,
      },
      {
        id: crypto.randomUUID(),
        userId: s.invitedByMe.userId,
        userName: 'Invited By Me',
        anchorPersonId: cy.id,
        grantedByUserId: s.user.id,
        grantedByName: 'Me',
        parentGrantId: null,
        active: false,
      },
    );
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    const table = screen.getByRole('table', { name: 'Members of Hale family' });
    expect(table).toHaveClass('data');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Name', 'Role', 'Branch / steward scope', 'Joined', 'Actions']);
    for (const h of within(table).getAllByRole('columnheader')) {
      expect(h).toHaveAttribute('scope', 'col');
    }
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const cells = within(r).getAllByRole('cell');
      expect(cells).toHaveLength(5);
      expect(cells.map((c) => c.getAttribute('data-label'))).toEqual(headers);
    }
    const other = within(rowOf('Other Person')).getAllByRole('cell');
    expect(other[0]).toHaveTextContent('Other Person');
    expect(other[0]!.querySelector('.row-meta')).toHaveTextContent('b@example.com');
    expect(other[1]).toContainElement(screen.getByLabelText('Role for Other Person'));
    expect(other[2]).toHaveTextContent('Steward of Bob Hale’s branch');
    expect(other[2]!.querySelector('.row-meta')).toHaveTextContent('Card: Dee Hale');
    expect(other[3]).toHaveTextContent(new Date('2026-03-04T12:00:00.000Z').toLocaleDateString());
    expect(within(other[4]!).getByRole('button', { name: 'Remove' })).toHaveClass('compact');
    expect(within(rowOf('Invited By Me')).getAllByRole('cell')[2]).toHaveTextContent(
      'Steward of Cy Hale’s branch (waiting for 2FA)',
    );
    const mine = within(rowOf('Me')).getAllByRole('cell');
    expect(mine[1]).toHaveTextContent('Owner');
    expect(mine[2]).toHaveTextContent('—');
    // The owner can't remove themselves, only link their own card.
    expect(within(mine[4]!).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(mine[4]!).getByRole('button', { name: 'More actions for Me' })).toBeVisible();
  });

  it('owner: links a member to a person, changes it, and unlinks after confirming', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    pick(rowOf('Other Person'), 'Other Person', 'Link to a person…');
    const dialog = await screen.findByRole('dialog', { name: 'Which person is Other Person?' });
    const link = within(dialog).getByRole('button', { name: 'Link' });
    expect(link).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Person'), { target: { value: cy.id } });
    fireEvent.click(link);
    await waitFor(() =>
      expect(s.trees.callsTo('setMemberPerson')).toEqual([
        { treeId: s.id, userId: s.other.userId, personId: cy.id },
      ]),
    );
    expect(
      await within(rowOf('Other Person')).findByText('Card: Cy Hale', { exact: false }),
    ).toBeInTheDocument();

    pick(rowOf('Other Person'), 'Other Person', 'Unlink from Cy Hale');
    const confirm = await screen.findByRole('dialog', {
      name: 'Unlink Other Person from Cy Hale?',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(s.trees.callsTo('setMemberPerson')).toHaveLength(2));
    expect(s.trees.callsTo('setMemberPerson')[1]).toEqual({
      treeId: s.id,
      userId: s.other.userId,
      personId: null,
    });
    await waitFor(() =>
      expect(within(rowOf('Other Person')).queryByText(/Card:/)).not.toBeInTheDocument(),
    );
  });

  it('owner: offers only cards no other member has, and shows a clash clearly', async () => {
    const s = setup();
    const t = s.trees.trees.get(s.id)!;
    t.members = t.members.map((m) =>
      m.userId === s.other.userId ? { ...m, personId: dee.id } : m,
    );
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    pick(rowOf('Invited By Me'), 'Invited By Me', 'Link to a person…');
    const dialog = await screen.findByRole('dialog', { name: 'Which person is Invited By Me?' });
    const options = within(within(dialog).getByLabelText('Person'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Choose…', 'Ada Hale', 'Bob Hale', 'Cy Hale']);
    s.trees.failNext('setMemberPerson', {
      code: 'PERSON_CLAIMED',
      message: MESSAGES.personClaimed,
    });
    fireEvent.change(within(dialog).getByLabelText('Person'), { target: { value: ada.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.personClaimed);
  });

  it('no link items for a non-owner', async () => {
    const s = setup('steward');
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('Invited By Me', { selector: '.member-name' });
    expect(
      within(rowOf('Invited By Me')).queryByRole('button', { name: /^More actions/ }),
    ).toBeNull();
  });

  it('owner: Make owner only on 2FA rows, and the controls vanish after a transfer', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    fireEvent.click(
      within(rowOf('Invited By Me')).getByRole('button', {
        name: 'More actions for Invited By Me',
      }),
    );
    expect(screen.queryByRole('menuitem', { name: 'Make owner' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Make owner (needs two-step verification)' }),
    ).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    pick(rowOf('Other Person'), 'Other Person', 'Make owner');
    const dialog = screen.getByRole('dialog', { name: 'Make Other Person the owner?' });
    expect(s.trees.callsTo('transferOwnership')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer ownership' }));
    await waitFor(() => expect(s.trees.callsTo('transferOwnership')).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /More actions for/ })).not.toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Role for Other Person')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invite someone' })).not.toBeInTheDocument();
  });

  it('owner: issues a reset link, copies it, and shows RESET_LINK_NOT_ALLOWED', async () => {
    const s = setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    pick(rowOf('Invited By Me'), 'Invited By Me', 'Reset link');
    const input = (await screen.findByLabelText('Reset link')) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/reset/fake-reset-1`);
    expect(
      screen.getByText(/Send this link to Invited By Me yourself. It works once, for 24 hours./),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(input.value));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    s.trees.failNext('createResetLink', {
      code: 'RESET_LINK_NOT_ALLOWED',
      message: MESSAGES.resetNotAllowed,
    });
    pick(rowOf('Invited By Me'), 'Invited By Me', 'Reset link');
    expect(await screen.findByText(MESSAGES.resetNotAllowed)).toBeInTheDocument();
  });

  it('editor: no role selects, Remove, invite form or email column', async () => {
    const s = setup('editor');
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('Other Person', { selector: '.member-name' });
    expect(screen.queryByRole('combobox', { name: /Role for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invite someone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Email' })).not.toBeInTheDocument();
    expect(s.trees.callsTo('listInvites')).toHaveLength(0);
  });

  it('active steward: controls only on rows they invited; invite form visible', async () => {
    const s = setup('steward');
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('Other Person', { selector: '.member-name' });
    expect(
      within(rowOf('Invited By Me')).getByLabelText('Role for Invited By Me'),
    ).toBeInTheDocument();
    expect(
      within(rowOf('Invited By Me')).getByRole('button', { name: 'Remove' }),
    ).toBeInTheDocument();
    expect(
      within(rowOf('Other Person')).queryByRole('button', { name: 'Remove' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More actions for/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite someone' })).toBeInTheDocument();
    // A steward may only anchor stewardship in their own branch.
    const anchors = within(screen.getByLabelText('Make them a steward of'));
    expect(anchors.getByRole('option', { name: 'Bob Hale' })).toBeInTheDocument();
    expect(anchors.queryByRole('option', { name: 'Cy Hale' })).not.toBeInTheDocument();
  });

  it('creates an invite, shows the link, lists it and revokes it', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByRole('heading', { name: 'Invite someone' });
    fireEvent.click(screen.getByLabelText('Can add and edit'));
    fireEvent.change(screen.getByLabelText('Make them a steward of'), {
      target: { value: bob.id },
    });
    fireEvent.change(screen.getByLabelText('This invite is for'), { target: { value: cy.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    const input = (await screen.findByLabelText('Invite link')) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/invite/fake-token-1`);
    expect(screen.getByText(/You won't be able to see this link again/)).toBeInTheDocument();
    // The form starts over: those choices were used, not a draft that keeps the dialog open.
    expect(screen.getByLabelText('Can add and edit')).not.toBeChecked();
    expect(screen.getByLabelText('This invite is for')).toHaveValue('');
    expect(s.trees.callsTo('createInvite')).toEqual([
      {
        treeId: s.id,
        input: { role: 'editor', stewardAnchorPersonId: bob.id, targetPersonId: cy.id },
      },
    ]);
    const open = (await screen.findByRole('heading', { name: 'Open invites' })).parentElement!;
    expect(await within(open).findByText(/steward of Bob Hale, for Cy Hale/)).toBeInTheDocument();
    fireEvent.click(within(open).getByRole('button', { name: 'Revoke' }));
    fireEvent.click(within(open).getByRole('button', { name: 'Revoke invite' }));
    await waitFor(() => expect(s.trees.callsTo('revokeInvite')).toHaveLength(1));
    expect(await within(open).findByText('No open invites.')).toBeInTheDocument();
  });

  it('grants and revokes stewardship', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByRole('heading', { name: 'Branch stewards' });
    await screen.findByText('a@example.com');
    fireEvent.change(screen.getByLabelText('Member'), { target: { value: s.other.userId } });
    fireEvent.change(screen.getByLabelText('Branch of'), { target: { value: cy.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Make steward' }));
    // The grant shows once, in the member's row (no second list under the form).
    const scope = () => within(rowOf('Other Person')).getAllByRole('cell')[2]!;
    await waitFor(() => expect(scope()).toHaveTextContent('Steward of Cy Hale’s branch'));
    expect(screen.queryByText(/looks after/)).not.toBeInTheDocument();
    expect(s.trees.callsTo('grantSteward')).toEqual([
      { treeId: s.id, input: { userId: s.other.userId, anchorPersonId: cy.id } },
    ]);
    // Revoke is in the member's More actions, behind a confirm.
    pick(rowOf('Other Person'), 'Other Person', 'Revoke stewardship');
    const ask = await screen.findByRole('dialog', { name: 'Revoke this stewardship?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Revoke stewardship' }));
    await waitFor(() => expect(s.trees.callsTo('revokeSteward')).toHaveLength(1));
    await waitFor(() => expect(scope()).not.toHaveTextContent('Steward of'));
  });

  it('hides the steward form and says why when nobody could be made a steward', async () => {
    const s = setup();
    // Only the owner is a member: there is nobody else to make a steward.
    s.trees.trees.get(s.id)!.members = [s.mine];
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByRole('heading', { name: 'Branch stewards' });
    expect(
      screen.queryByRole('heading', { name: 'Make someone a steward' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make steward' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Invite someone and have them join first; then you can make them a steward.',
      ),
    ).toBeInTheDocument();
  });

  it('uses a neutral message when a member, grant or invite no longer exists', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    s.trees.failNext('removeMember', { code: 'NOT_FOUND', message: MESSAGES.notFound });
    const row = rowOf('Invited By Me');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Remove from tree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.itemGone);
    expect(screen.queryByText(MESSAGES.notFound)).not.toBeInTheDocument();
  });

  it('shows a refused transfer in the members alert', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    s.trees.failNext('transferOwnership', {
      code: 'TWO_FACTOR_REQUIRED',
      message: MESSAGES.twoFactorRequired,
    });
    pick(rowOf('Other Person'), 'Other Person', 'Make owner');
    fireEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.twoFactorRequired);
  });

  it('ignores a second submit of the grant form while one is running', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    s.trees.hold('grantSteward');
    const form = screen.getByRole('button', { name: 'Make steward' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    s.trees.release();
    await waitFor(() => expect(s.trees.callsTo('grantSteward')).toHaveLength(1));
    expect(s.trees.callsTo('grantSteward')).toHaveLength(1);
  });

  it('keeps the grant form’s member selection valid when that member leaves', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    const select = screen.getByLabelText('Member') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: s.other.userId } });
    const row = rowOf('Other Person');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Remove from tree' }));
    await waitFor(() =>
      expect(screen.queryByText('Other Person', { selector: '.member-name' })).toBeNull(),
    );
    expect((screen.getByLabelText('Member') as HTMLSelectElement).value).toBe(s.invitedByMe.userId);
  });

  it('clears the reset link box after another successful action', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    pick(rowOf('Invited By Me'), 'Invited By Me', 'Reset link');
    await screen.findByLabelText('Reset link');
    fireEvent.change(screen.getByLabelText('Role for Invited By Me'), {
      target: { value: 'editor' },
    });
    await waitFor(() => expect(screen.queryByLabelText('Reset link')).not.toBeInTheDocument());
  });

  it('clears the invite link box after revoking an invite', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByRole('heading', { name: 'Invite someone' });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await screen.findByLabelText('Invite link');
    const open = (await screen.findByRole('heading', { name: 'Open invites' })).parentElement!;
    fireEvent.click(await within(open).findByRole('button', { name: 'Revoke' }));
    fireEvent.click(within(open).getByRole('button', { name: 'Revoke invite' }));
    await waitFor(() => expect(screen.queryByLabelText('Invite link')).not.toBeInTheDocument());
  });

  it('says so when the clipboard is unavailable', async () => {
    const s = setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
      configurable: true,
    });
    renderAt(`/trees/${s.id}/members`, s);
    await screen.findByText('a@example.com');
    pick(rowOf('Invited By Me'), 'Invited By Me', 'Reset link');
    await screen.findByLabelText('Reset link');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(
      await screen.findByText('Couldn’t copy — select the link and copy it'),
    ).toBeInTheDocument();
  });
});
