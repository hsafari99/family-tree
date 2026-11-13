import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeTreesApi, fakePerson } from '../test/fake-trees';
import { renderAt } from '../test/render';

const ada = fakePerson({
  givenName: 'Ada',
  surname: 'Hale',
  birthYear: 1930,
  deathYear: 1998,
  isLiving: false,
});
const bob = fakePerson({
  givenName: 'Bob',
  surname: 'Hale',
  birthYear: 1990,
  deathYear: null,
  isLiving: true,
});

function setup(opts: Parameters<FakeTreesApi['addTree']>[0] = {}) {
  const auth = new FakeAuthApi();
  auth.addUser(
    { email: 'ada@example.com', name: 'Ada', twoFactorEnabled: true },
    { signedIn: true },
  );
  const trees = new FakeTreesApi();
  const id = trees.addTree({ name: 'Hale family', persons: [ada, bob], ...opts });
  return { auth, trees, id };
}

const viewerCaps = {
  editAnywhere: false,
  manageTree: false,
  invite: false,
  grantStewardship: false,
};

describe('TreePage', () => {
  it('shows the name and people with years and (you), with no role or starting-person line', async () => {
    const s = setup();
    s.trees.trees.get(s.id)!.detail.me.personId = bob.id;
    renderAt(`/trees/${s.id}?tab=people`, s);
    expect(await screen.findByRole('heading', { name: 'Hale family' })).toBeInTheDocument();
    expect(screen.queryByText(/You are (the|an?) \w+ of this tree/)).toBeNull();
    expect(screen.queryByText(/^Starting person:/)).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: 'All people (2)' });
    const list = within(dialog).getByRole('list', { name: 'People' });
    expect(list).toHaveClass('row-list');
    const items = within(list).getAllByRole('listitem');
    const adaRow = items.find((i) => i.textContent?.includes('Ada Hale'))!;
    const bobRow = items.find((i) => i.textContent?.includes('Bob Hale'))!;
    expect(adaRow.querySelector('.row-meta')).toHaveTextContent('1930–1998');
    expect(bobRow.querySelector('.row-meta')).toHaveTextContent('b. 1990');
    expect(within(bobRow).getByText('You')).toHaveClass('badge');
    expect(within(adaRow).queryByText('You')).toBeNull();
    expect(screen.getByRole('button', { name: 'Members and invites' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
  });

  it('hides tree settings from viewers and editors', async () => {
    const s = setup({ role: 'viewer', detail: { capabilities: viewerCaps } });
    renderAt(`/trees/${s.id}?tab=settings`, s);
    await screen.findByRole('button', { name: 'Members and invites' });
    expect(screen.queryByRole('button', { name: 'Tree settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Tree settings' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tree name')).not.toBeInTheDocument();
  });

  it('opens Tree settings in a dialog from the side panel, at ?tab=settings', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}`, s);
    expect(await screen.findByRole('heading', { name: 'Hale family' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Tree name')).not.toBeInTheDocument();
    const row = within(screen.getByRole('complementary', { name: 'Details' })).getByRole('button', {
      name: 'Tree settings',
    });
    expect(row).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(row);
    const dialog = await screen.findByRole('dialog', { name: 'Tree settings' });
    expect(within(dialog).getByLabelText('Tree name')).toHaveValue('Hale family');
    expect(r.where()).toMatch(/[?&]tab=settings/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(r.where()).not.toMatch(/tab=/);
    expect(row).toHaveFocus();
  });

  it('renames the tree', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}?tab=settings`, s);
    const field = await screen.findByLabelText('Tree name');
    expect(field).toHaveValue('Hale family');
    fireEvent.change(field, { target: { value: 'The Hales' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('heading', { name: 'The Hales' })).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(s.trees.callsTo('updateTree')).toEqual([{ treeId: s.id, input: { name: 'The Hales' } }]);
  });

  it('changes the starting person', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/${bob.id}?tab=settings`, s);
    fireEvent.change(await screen.findByLabelText('Starting person'), {
      target: { value: bob.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save starting person' }));
    // Bob's panel, behind the dialog, now says he is the starting person.
    await screen.findByText('Saved');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /^Bob Hale .*\(Starting person\)/,
        hidden: true,
      }),
    ).toBeInTheDocument();
    expect(s.trees.callsTo('updateTree')).toEqual([
      { treeId: s.id, input: { rootPersonId: bob.id } },
    ]);
  });

  it('deletes only after the exact name is typed and confirmed', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}?tab=settings`, s);
    const del = await screen.findByRole('button', { name: 'Delete tree' });
    expect(del).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type the tree name to confirm'), {
      target: { value: 'Hale famil' },
    });
    expect(screen.getByRole('button', { name: 'Delete tree' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type the tree name to confirm'), {
      target: { value: 'Hale family' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete tree' }));
    expect(s.trees.callsTo('deleteTree')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete this tree' }));
    expect(await screen.findByRole('heading', { name: 'Your trees' })).toBeInTheDocument();
    expect(s.trees.callsTo('deleteTree')).toEqual([s.id]);
  });

  it('shows the not-found message for an unknown tree', async () => {
    const s = setup();
    renderAt(`/trees/${crypto.randomUUID()}`, s);
    expect(await screen.findByText(MESSAGES.notFound)).toBeInTheDocument();
    // The way back is the header's My trees.
    expect(screen.getByRole('link', { name: 'My trees' })).toHaveAttribute('href', '/');
  });

  it('tells an inactive steward to turn on 2FA, and an active one which branches', async () => {
    const grants = [{ id: crypto.randomUUID(), anchorPersonId: bob.id }];
    const inactive = setup({
      role: 'viewer',
      detail: {
        capabilities: viewerCaps,
        me: { role: 'viewer', personId: null, steward: { grants, active: false } },
      },
    });
    const { unmount } = renderAt(`/trees/${inactive.id}`, inactive);
    // The notice links straight to the two-step setup.
    expect(
      await screen.findByRole('link', { name: 'Turn on two-step verification' }),
    ).toHaveAttribute('href', '/account/two-step');
    unmount();
    const active = setup({
      role: 'viewer',
      detail: {
        capabilities: viewerCaps,
        me: { role: 'viewer', personId: null, steward: { grants, active: true } },
      },
    });
    renderAt(`/trees/${active.id}`, active);
    expect(await screen.findByText('You look after the branches of: Bob Hale')).toBeInTheDocument();
    expect(within(document.body).queryByText(/Turn on two-step/)).not.toBeInTheDocument();
  });

  it('cannot delete after the typed name stops matching', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}?tab=settings`, s);
    const field = await screen.findByLabelText('Type the tree name to confirm');
    fireEvent.change(field, { target: { value: 'Hale family' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete tree' }));
    expect(screen.getByRole('button', { name: 'Yes, delete this tree' })).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'Hale famil' } });
    expect(screen.queryByRole('button', { name: 'Yes, delete this tree' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete tree' })).toBeDisabled();
    expect(s.trees.callsTo('deleteTree')).toHaveLength(0);
  });

  it('links people to their panels and marks the selected one', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/${bob.id}?tab=people`, s);
    const dialog = await screen.findByRole('dialog', { name: 'All people (2)' });
    const link = within(dialog).getByRole('link', { name: /Bob Hale/ });
    expect(link).toHaveAttribute('href', `/trees/${s.id}/people/${bob.id}`);
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(within(dialog).getByRole('link', { name: /Ada Hale/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('has one compact Show on tree button per person that focuses the canvas', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/${bob.id}?view=full&tab=people`, s);
    const dialog = await screen.findByRole('dialog', { name: 'All people (2)' });
    const list = within(dialog).getByRole('list', { name: 'People' });
    const show = within(list).getByRole('button', { name: 'Show Ada Hale on tree' });
    expect(show).toHaveClass('compact');
    expect(show).toHaveTextContent('Show on tree');
    expect(within(list).getAllByRole('button', { name: /on tree$/ })).toHaveLength(2);
    fireEvent.click(show);
    // The dialog closes and the panel stays on Bob; the canvas switches to focus on Ada.
    expect(r.where()).toBe(`/trees/${s.id}/people/${bob.id}?focus=${ada.id}`);
  });

  it('shows Add a person to editors and Trash to the owner only', async () => {
    const owner = setup();
    const { unmount } = renderAt(`/trees/${owner.id}`, owner);
    expect(await screen.findByRole('button', { name: 'Add a person' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
    expect(screen.getByRole('button', { name: 'Trash' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
    unmount();
    const viewer = setup({ role: 'viewer', detail: { capabilities: viewerCaps } });
    renderAt(`/trees/${viewer.id}`, viewer);
    await screen.findByRole('button', { name: 'Members and invites' });
    expect(screen.queryByRole('button', { name: 'Add a person' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trash' })).not.toBeInTheDocument();
  });

  it('refuses the add-person page to a viewer', async () => {
    const s = setup({ role: 'viewer', detail: { capabilities: viewerCaps } });
    renderAt(`/trees/${s.id}/people/new`, s);
    expect(await screen.findByText('You can’t add people to this tree')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add person' })).not.toBeInTheDocument();
  });

  it('lets the owner download the export', async () => {
    const s = setup();
    const hrefs: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      hrefs.push(this.href);
    });
    renderAt(`/trees/${s.id}?tab=settings`, s);
    const section = await screen.findByRole('region', { name: 'Export' });
    expect(section).toHaveTextContent('living relatives');
    s.trees.hold('exportTree');
    fireEvent.click(within(section).getByRole('button', { name: 'Download export' }));
    expect(
      await within(section).findByRole('button', { name: 'Preparing export…' }),
    ).toBeDisabled();
    s.trees.release();
    expect(await within(section).findByText('Your export is downloading.')).toBeInTheDocument();
    expect(s.trees.callsTo('exportTree')).toEqual([s.id]);
    expect(hrefs).toEqual([`https://api.example.com/api/v1/trees/${s.id}/export?ticket=fake`]);
    click.mockRestore();
  });

  it('shows a fixed message when the export is refused', async () => {
    const s = setup();
    s.trees.failNext('exportTree', { code: 'RATE_LIMITED', message: MESSAGES.exportLimited });
    renderAt(`/trees/${s.id}?tab=settings`, s);
    const section = await screen.findByRole('region', { name: 'Export' });
    fireEvent.click(within(section).getByRole('button', { name: 'Download export' }));
    expect(await within(section).findByText(MESSAGES.exportLimited)).toBeInTheDocument();
  });

  it('has no Export for viewers and editors', async () => {
    const s = setup({ role: 'viewer', detail: { capabilities: viewerCaps } });
    renderAt(`/trees/${s.id}?tab=settings`, s);
    await screen.findByRole('button', { name: 'Members and invites' });
    expect(screen.queryByRole('region', { name: 'Export' })).not.toBeInTheDocument();
  });
});
