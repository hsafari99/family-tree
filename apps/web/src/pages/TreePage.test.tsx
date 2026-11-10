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
  it('shows the name, role line and people with years and (you)', async () => {
    const s = setup();
    s.trees.trees.get(s.id)!.detail.me.personId = bob.id;
    renderAt(`/trees/${s.id}`, s);
    expect(await screen.findByRole('heading', { name: 'Hale family' })).toBeInTheDocument();
    expect(screen.getByText('You are the owner of this tree.')).toBeInTheDocument();
    expect(screen.getByText('Starting person: Ada Hale')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'People (2)' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.find((i) => i.textContent?.includes('Ada Hale'))).toHaveTextContent('1930–1998');
    expect(items.find((i) => i.textContent?.includes('Bob Hale'))).toHaveTextContent(
      'b. 1990 (you)',
    );
    expect(screen.getByRole('link', { name: 'Members and invites' })).toHaveAttribute(
      'href',
      `/trees/${s.id}/members`,
    );
  });

  it('hides tree settings from viewers and editors', async () => {
    const s = setup({ role: 'viewer', detail: { capabilities: viewerCaps } });
    renderAt(`/trees/${s.id}`, s);
    expect(await screen.findByText('You are a viewer of this tree.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tree settings' })).not.toBeInTheDocument();
  });

  it('renames the tree', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
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
    renderAt(`/trees/${s.id}`, s);
    fireEvent.change(await screen.findByLabelText('Starting person'), {
      target: { value: bob.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save starting person' }));
    expect(await screen.findByText('Starting person: Bob Hale')).toBeInTheDocument();
    expect(s.trees.callsTo('updateTree')).toEqual([
      { treeId: s.id, input: { rootPersonId: bob.id } },
    ]);
  });

  it('deletes only after the exact name is typed and confirmed', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
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
    expect(screen.getByRole('link', { name: 'Back to your trees' })).toHaveAttribute('href', '/');
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
    expect(
      await screen.findByText(/Turn on two-step verification in Account settings/),
    ).toBeInTheDocument();
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
    renderAt(`/trees/${s.id}`, s);
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
    renderAt(`/trees/${s.id}/people/${bob.id}`, s);
    const link = await screen.findByRole('link', { name: /Bob Hale/ });
    expect(link).toHaveAttribute('href', `/trees/${s.id}/people/${bob.id}`);
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Ada Hale/ })).not.toHaveAttribute('aria-current');
  });

  it('shows Add a person to editors and Trash to the owner only', async () => {
    const owner = setup();
    const { unmount } = renderAt(`/trees/${owner.id}`, owner);
    expect(await screen.findByRole('link', { name: 'Add a person' })).toHaveAttribute(
      'href',
      `/trees/${owner.id}/people/new`,
    );
    expect(screen.getByRole('link', { name: 'Trash' })).toHaveAttribute(
      'href',
      `/trees/${owner.id}/trash`,
    );
    unmount();
    const viewer = setup({ role: 'viewer', detail: { capabilities: viewerCaps } });
    renderAt(`/trees/${viewer.id}`, viewer);
    await screen.findByText('You are a viewer of this tree.');
    expect(screen.queryByRole('link', { name: 'Add a person' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Trash' })).not.toBeInTheDocument();
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
    renderAt(`/trees/${s.id}`, s);
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
    renderAt(`/trees/${s.id}`, s);
    const section = await screen.findByRole('region', { name: 'Export' });
    fireEvent.click(within(section).getByRole('button', { name: 'Download export' }));
    expect(await within(section).findByText(MESSAGES.exportLimited)).toBeInTheDocument();
  });

  it('has no Export for viewers and editors', async () => {
    const s = setup({ role: 'viewer', detail: { capabilities: viewerCaps } });
    renderAt(`/trees/${s.id}`, s);
    expect(await screen.findByText('You are a viewer of this tree.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Export' })).not.toBeInTheDocument();
  });
});
