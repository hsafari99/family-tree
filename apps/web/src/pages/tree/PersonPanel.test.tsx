import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../auth/api';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson, fakePersonView } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

const ada = fakePerson({ givenName: 'Ada', surname: 'King', birthYear: 1815, deathYear: 1852 });
const root = fakePerson({ givenName: 'Root', surname: 'Person' });

function setup(
  partialView: Parameters<typeof fakePersonView>[1] = {},
  role: 'owner' | 'viewer' = 'owner',
) {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
  const trees = new FakeTreesApi();
  const id = trees.addTree({
    persons: [{ ...root }, { ...ada }],
    ...(role === 'viewer'
      ? {
          role,
          detail: {
            capabilities: {
              editAnywhere: false,
              manageTree: false,
              invite: false,
              grantStewardship: false,
            },
          },
        }
      : {}),
  });
  const view = fakePersonView(ada, partialView);
  trees.trees.get(id)!.people.set(ada.id, view);
  return { auth, trees, id, view };
}

const at = (s: { id: string }, query = '') => `/trees/${s.id}/people/${ada.id}${query}`;

describe('PersonPanel', () => {
  it('shows the name, fuzzy dates and the biography as plain text with line breaks', async () => {
    const s = setup();
    s.view.person.birthDate = { qualifier: 'about', date1: '1815' };
    s.view.person.biography = '<b>x</b>\nsecond line';
    renderAt(at(s), s);
    expect(await screen.findByRole('heading', { name: /Ada King/ })).toBeInTheDocument();
    expect(screen.getByText('about 1815')).toBeInTheDocument();
    const prose = screen.getByText(/second line/);
    expect(prose).toHaveClass('prose');
    expect(prose.textContent).toBe('<b>x</b>\nsecond line');
    expect(prose.querySelector('b')).toBeNull();
  });

  it('edits the surname and refreshes the list', async () => {
    const s = setup();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(s.trees.callsTo('updatePerson')).toMatchObject([
      { input: { version: 1, surname: 'Lovelace' } },
    ]);
    const list = screen.getByRole('link', { name: /Ada Lovelace/ });
    expect(list).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: /Ada Lovelace/ })).toBeInTheDocument();
  });

  it('validates death before birth and living with a death date, without calling', async () => {
    const s = setup();
    s.view.person.birthDate = { qualifier: 'exact', date1: '1900' };
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    const dates = screen.getAllByLabelText('Date');
    fireEvent.change(dates[1]!, { target: { value: '1800' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Living' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Death can’t be before birth')).toBeInTheDocument();
    expect(s.trees.callsTo('updatePerson')).toEqual([]);
    fireEvent.change(dates[1]!, { target: { value: '1950' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Someone with death details can’t be marked as living'),
    ).toBeInTheDocument();
    expect(s.trees.callsTo('updatePerson')).toEqual([]);
  });

  it('shows the stale-edit message, reloads, and keeps the draft', async () => {
    const s = setup();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    s.trees.failNext('updatePerson', { code: 'CONFLICT', message: MESSAGES.staleEdit });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(new RegExp(MESSAGES.staleEdit.slice(0, 30))),
    ).toBeInTheDocument();
    const before = s.trees.callsTo('getPerson').length;
    fireEvent.click(screen.getByRole('button', { name: 'Load the latest version' }));
    await waitFor(() => expect(s.trees.callsTo('getPerson').length).toBe(before + 1));
    expect(screen.getByLabelText('Last name')).toHaveValue('Lovelace');
  });

  it('shows no edit buttons when the view cannot be edited', async () => {
    const s = setup({ capabilities: { edit: false, addRelative: false, delete: false } }, 'viewer');
    renderAt(at(s), s);
    await screen.findByRole('heading', { name: /Ada King/ });
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Places' }));
    expect(await screen.findByText('Places lived')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit places' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a place' })).not.toBeInTheDocument();
  });

  it('adds, edits and removes a place lived', async () => {
    const s = setup();
    renderAt(at(s, '?tab=places'), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a place' }));
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: 'Leeds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add place' }));
    expect(await screen.findByText(/Leeds/)).toBeInTheDocument();
    expect(s.trees.callsTo('addResidence')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: 'York' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save place' }));
    expect(await screen.findByText(/York/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(s.trees.callsTo('deleteResidence')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(screen.queryByText(/York/)).not.toBeInTheDocument());
    expect(s.trees.callsTo('deleteResidence')).toHaveLength(1);
  });

  it('shows history with action labels and field changes', async () => {
    const s = setup();
    s.trees.trees.get(s.id)!.history.set(ada.id, [
      {
        id: crypto.randomUUID(),
        action: 'person.update',
        at: '2026-01-01T00:00:00.000Z',
        by: null,
        changes: [{ field: 'surname', before: 'King', after: 'Lovelace' }],
      },
    ]);
    renderAt(at(s, '?tab=history'), s);
    expect(await screen.findByText('Details changed')).toBeInTheDocument();
    expect(screen.getByText('Last name: King → Lovelace')).toBeInTheDocument();
    expect(screen.getByText(/by a former member/)).toBeInTheDocument();
  });

  it('keeps the tab in the URL', async () => {
    const s = setup();
    renderAt(at(s, '?tab=history'), s);
    expect(await screen.findByText('No changes recorded yet.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Places' }));
    expect(await screen.findByText('Places lived')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Places' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Photos' }));
    expect(screen.getByText('Photos arrive in a later version.')).toBeInTheDocument();
  });

  it('shows the not-found message for an unknown person', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/${crypto.randomUUID()}`, s);
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.personNotFound);
    expect(
      within(screen.getByRole('alert').parentElement!).getByRole('link', {
        name: 'Back to the list',
      }),
    ).toBeInTheDocument();
  });
});
