import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

const robert = fakePerson({ givenName: 'Robert', surname: 'Hale' });

function setup(opts: Parameters<FakeTreesApi['addTree']>[0] = {}) {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
  const trees = new FakeTreesApi();
  const id = trees.addTree({ persons: [{ ...robert }], ...opts });
  return { auth, trees, id };
}

const fill = (name: string) =>
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: name } });

describe('AddPersonForm', () => {
  it('opens in a dialog over the tree from the panel, which stays usable behind it', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/${robert.id}?view=full`, { ...s, toasts: true });
    const row = await screen.findByRole('button', { name: 'Add a person' });
    expect(row).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(row);
    const dialog = await screen.findByRole('dialog', { name: 'Add a person' });
    expect(r.where()).toBe(`/trees/${s.id}/people/${robert.id}?view=full&tab=new-person`);
    // The panel still shows Robert, not the form.
    const panel = screen.getByRole('complementary', { name: 'Details' });
    expect(within(panel).getByRole('heading', { level: 2, name: /Robert Hale/ })).toBeVisible();
    expect(within(panel).queryByLabelText('First name')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: 'Ada' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add person' }));
    // Created: the dialog closes, a toast says so, and the new person is selected.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Ada added')).toBeInTheDocument();
    expect(await within(panel).findByRole('heading', { level: 2, name: 'Ada' })).toBeVisible();
    expect(r.where()).toMatch(new RegExp(`^/trees/${s.id}/people/[^/?]+\\?view=full$`));
  });

  it('the old add-person link opens the dialog', async () => {
    const s = setup();
    const r = renderAt(`/trees/${s.id}/people/new?view=full`, s);
    expect(await screen.findByRole('dialog', { name: 'Add a person' })).toBeInTheDocument();
    expect(r.where()).toMatch(/[?&]tab=new-person/);
    expect(r.where()).toMatch(/[?&]view=full/);
    expect(r.where()).not.toMatch(/people\/new/);
  });

  it('adds an unattached person and opens their panel', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/new`, s);
    expect(await screen.findByRole('heading', { name: 'Add a person' })).toBeInTheDocument();
    fill('Ada');
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    expect(await screen.findByRole('heading', { name: 'Ada' })).toBeInTheDocument();
    expect(s.trees.callsTo('createPerson')).toEqual([
      { treeId: s.id, input: { person: { givenName: 'Ada', sex: 'unknown' } } },
    ]);
    // The tree reloads with her: All people counts two.
    fireEvent.click(screen.getByRole('button', { name: 'List of all people' }));
    expect(await screen.findByRole('dialog', { name: 'All people (2)' })).toBeInTheDocument();
  });

  it('connects the new person to someone', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/new`, s);
    await screen.findByRole('heading', { name: 'Add a person' });
    fill('Kit');
    fireEvent.change(screen.getByLabelText('Related to'), { target: { value: robert.id } });
    fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'child' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(s.trees.callsTo('createPerson')[0]).toMatchObject({
      input: { attach: { to: robert.id, as: 'child', kind: 'biological' } },
    });
  });

  it('offers Related to with a Relationship select, including Partner or spouse of (brief #10)', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/new`, s);
    await screen.findByRole('heading', { name: 'Add a person' });
    const related = screen.getByLabelText('Related to');
    expect(related).toHaveDisplayValue('No one');
    const rel = screen.getByLabelText('Relationship');
    expect(rel).toBeDisabled();
    const texts = () => [...rel.querySelectorAll('option')].map((o) => o.textContent);
    expect(texts()).toEqual([
      'Parent of …',
      'Child of …',
      'Partner or spouse of …',
      'Sibling of …',
    ]);
    fireEvent.change(related, { target: { value: robert.id } });
    expect(rel).toBeEnabled();
    expect(texts()).toEqual([
      'Parent of Robert Hale',
      'Child of Robert Hale',
      'Partner or spouse of Robert Hale',
      'Sibling of Robert Hale',
    ]);
    expect((rel.querySelector('option') as HTMLOptionElement).value).toBe('parent');
    expect(screen.queryByLabelText('Type')).toBeNull();
    fireEvent.change(rel, { target: { value: 'partner' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'partnership' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'partners' } });
    fill('Pat');
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(s.trees.callsTo('createPerson')[0]).toMatchObject({
      input: {
        attach: {
          to: robert.id,
          as: 'partner',
          union: { type: 'partnership', status: 'partners' },
        },
      },
    });
  });

  it('requires a connection for a steward without editing rights', async () => {
    const s = setup({
      role: 'viewer',
      detail: {
        me: { role: 'viewer', personId: null, steward: { grants: [], active: true } },
        capabilities: {
          editAnywhere: false,
          manageTree: false,
          invite: false,
          grantStewardship: false,
        },
      },
    });
    renderAt(`/trees/${s.id}/people/new`, s);
    await screen.findByRole('heading', { name: 'Add a person' });
    fill('Kit');
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    expect(
      await screen.findByText('Choose someone in your branch to connect them to.'),
    ).toBeInTheDocument();
    expect(s.trees.callsTo('createPerson')).toEqual([]);
  });

  it('sends the birth year as an exact date (year precision by default)', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/new`, s);
    await screen.findByRole('heading', { name: 'Add a person' });
    fill('Ada');
    const born = within(screen.getByRole('group', { name: 'Born' }));
    expect(born.getByLabelText('Precision')).toHaveValue('year');
    fireEvent.change(born.getByLabelText('Year'), { target: { value: '1990' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(s.trees.callsTo('createPerson')[0]).toMatchObject({
      input: { person: { birthDate: { qualifier: 'exact', date1: '1990' } } },
    });
  });
});

describe('AddPersonForm birth date', () => {
  it('checks the draft, then sends an about-month date', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/new`, s);
    await screen.findByRole('heading', { name: 'Add a person' });
    fill('Ada');
    const born = within(screen.getByRole('group', { name: 'Born' }));
    fireEvent.change(born.getByLabelText('Precision'), { target: { value: 'month' } });
    fireEvent.change(born.getByLabelText('How certain'), { target: { value: 'about' } });
    fireEvent.change(born.getByLabelText('Year'), { target: { value: '1990' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    expect(await screen.findByText('Choose a month')).toBeInTheDocument();
    expect(s.trees.callsTo('createPerson')).toEqual([]);
    fireEvent.change(born.getByLabelText('Month'), { target: { value: '05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(s.trees.callsTo('createPerson')[0]).toMatchObject({
      input: { person: { birthDate: { qualifier: 'about', date1: '1990-05' } } },
    });
  });
});

describe('AddPersonForm duplicate check', () => {
  const ada = fakePerson({
    givenName: 'Ada',
    surname: 'Lovelace',
    birthYear: 1815,
    deathYear: 1852,
  });
  const dupSetup = () => setup({ persons: [{ ...robert }, { ...ada }] });
  const submit = (name = 'Ada', surname = 'Lovelace') => {
    fill(name);
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: surname } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
  };

  it('Yes with no connection opens the existing person', async () => {
    const s = dupSetup();
    renderAt(`/trees/${s.id}/people/new`, s);
    await screen.findByRole('heading', { name: 'Add a person' });
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, use Ada Lovelace' }));
    expect(await screen.findByRole('heading', { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(s.trees.callsTo('createPerson')).toHaveLength(0);
    expect(s.trees.callsTo('addRelative')).toHaveLength(0);
  });

  it('Yes with a connection links them', async () => {
    const s = dupSetup();
    renderAt(`/trees/${s.id}/people/new`, s);
    await screen.findByRole('heading', { name: 'Add a person' });
    fireEvent.change(screen.getByLabelText('Related to'), { target: { value: robert.id } });
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, use Ada Lovelace' }));
    await waitFor(() => expect(s.trees.callsTo('addRelative')).toHaveLength(1));
    expect(s.trees.callsTo('addRelative')[0]).toMatchObject({
      personId: robert.id,
      input: { personId: ada.id, as: 'child', kind: 'biological' },
    });
    expect(await screen.findByRole('heading', { name: /Ada Lovelace/ })).toBeInTheDocument();
  });

  it('No creates once and opens the new person', async () => {
    const s = dupSetup();
    renderAt(`/trees/${s.id}/people/new`, s);
    await screen.findByRole('heading', { name: 'Add a person' });
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'No, add a new person' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: /Ada Lovelace/ })).toBeInTheDocument();
  });
});
