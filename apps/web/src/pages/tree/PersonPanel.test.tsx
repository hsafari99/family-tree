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

  it('retries a stale save with only the user’s fields on the latest version', async () => {
    const s = setup();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    // Someone else saves meanwhile.
    const stored = s.trees.trees.get(s.id)!.people.get(ada.id)!;
    stored.person.version = 2;
    stored.person.occupation = 'Mathematician';
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load the latest version' }));
    await waitFor(() => expect(screen.getByLabelText('Occupation')).toHaveValue('Mathematician'));
    expect(screen.getByLabelText('Last name')).toHaveValue('Lovelace');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    const calls = s.trees.callsTo('updatePerson') as { input: Record<string, unknown> }[];
    expect(calls.at(-1)!.input).toEqual({ version: 2, surname: 'Lovelace' });
    expect(stored.person.occupation).toBe('Mathematician');
    expect(stored.person.surname).toBe('Lovelace');
  });

  it('makes no call when nothing was changed', async () => {
    const s = setup();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
    );
    expect(s.trees.callsTo('updatePerson')).toEqual([]);
  });

  it('shows an error when a reload fails even though a view is loaded', async () => {
    const s = setup();
    renderAt(at(s, '?tab=places'), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a place' }));
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: 'Leeds' } });
    s.trees.failNext('getPerson', { code: 'NOT_FOUND', message: MESSAGES.personNotFound });
    fireEvent.click(screen.getByRole('button', { name: 'Add place' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.personNotFound);
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

  describe('Relations', () => {
    const mom = fakePerson({ givenName: 'Mom', surname: 'King' });
    const pat = fakePerson({ givenName: 'Pat', surname: 'Moss' });
    const mia = fakePerson({ givenName: 'Mia', surname: 'King' });
    const sib = fakePerson({ givenName: 'Sib', surname: 'King' });
    const parentUnion = crypto.randomUUID();
    const union = crypto.randomUUID();
    const parentLink = crypto.randomUUID();
    const childLink = crypto.randomUUID();

    function withRelations(role: 'owner' | 'viewer' = 'owner') {
      const s = setup(
        role === 'viewer'
          ? { capabilities: { edit: false, addRelative: false, delete: false } }
          : {},
        role,
      );
      Object.assign(s.view.relations, {
        parents: [
          {
            linkId: parentLink,
            kind: 'biological',
            union: { id: parentUnion, type: 'marriage', status: 'married' },
            parents: [mom],
          },
        ],
        unions: [
          {
            id: union,
            type: 'marriage',
            status: 'married',
            startDate: { qualifier: 'exact', date1: '1970' },
            endDate: null,
            partner: pat,
            children: [{ linkId: childLink, kind: 'adoptive', person: mia }],
          },
        ],
        siblings: [{ unionId: parentUnion, kind: 'biological', person: sib }],
      });
      return s;
    }
    const open = (s: ReturnType<typeof setup>) => renderAt(at(s, '?tab=relations'), s);

    it('shows parents, partners with children, and siblings as links', async () => {
      const s = withRelations();
      open(s);
      expect(await screen.findByRole('link', { name: 'Mom King' })).toHaveAttribute(
        'href',
        `/trees/${s.id}/people/${mom.id}`,
      );
      expect(screen.getByText('Unknown parent', { exact: false })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Pat Moss' })).toBeInTheDocument();
      expect(screen.getByText(/Marriage/).closest('p')).toHaveTextContent(
        'Marriage from 1970 (married)',
      );
      expect(screen.getByRole('link', { name: 'Mia King' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sib King' })).toBeInTheDocument();
    });

    it('edits a union status', async () => {
      const s = withRelations();
      open(s);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit relationship' }));
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'divorced' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save relationship' }));
      await waitFor(() => expect(s.trees.callsTo('updateUnion')).toHaveLength(1));
      expect(s.trees.callsTo('updateUnion')[0]).toEqual({
        treeId: s.id,
        unionId: union,
        input: { status: 'divorced' },
      });
    });

    it('changes a child link kind', async () => {
      const s = withRelations();
      open(s);
      fireEvent.change(await screen.findByLabelText('Link kind for Mia King'), {
        target: { value: 'step' },
      });
      await waitFor(() => expect(s.trees.callsTo('updateParentChild')).toHaveLength(1));
      expect(s.trees.callsTo('updateParentChild')[0]).toEqual({
        treeId: s.id,
        linkId: childLink,
        input: { kind: 'step' },
      });
    });

    it('removes a relationship only after two clicks', async () => {
      const s = withRelations();
      open(s);
      fireEvent.click(await screen.findByRole('button', { name: 'Remove relationship' }));
      expect(s.trees.callsTo('deleteUnion')).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Yes, move to Trash' }));
      expect(await screen.findByText('Moved to Trash.')).toBeInTheDocument();
      expect(s.trees.callsTo('deleteUnion')).toHaveLength(1);
      expect(screen.queryByRole('link', { name: 'Pat Moss' })).not.toBeInTheDocument();
    });

    it('shows a viewer no edit, remove or add controls', async () => {
      const s = withRelations('viewer');
      open(s);
      await screen.findByRole('link', { name: 'Pat Moss' });
      expect(screen.queryByRole('button', { name: /Edit|Remove|Add/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Mia King' }).closest('li')).toHaveTextContent(
        'Adopted',
      );
    });
  });
});

describe('PersonPanel add parameter', () => {
  it('opens the Relations tab with the add form for ?tab=relations&add=child', async () => {
    const s = setup();
    renderAt(at(s, '?tab=relations&add=child'), s);
    expect(await screen.findByRole('form', { name: 'Add child' })).toBeInTheDocument();
  });

  it('closes the form on Cancel', async () => {
    const s = setup();
    renderAt(at(s, '?tab=relations&add=child'), s);
    await screen.findByRole('form', { name: 'Add child' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add child' })).toBeNull());
    // The parameter is gone too: opening another role starts clean.
    fireEvent.click(screen.getByRole('button', { name: 'Add partner' }));
    expect(await screen.findByRole('form', { name: 'Add partner' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add child' })).toBeNull();
  });

  it('opens nothing for add=sibling when there are no parents', async () => {
    const s = setup();
    renderAt(at(s, '?tab=relations&add=sibling'), s);
    expect(await screen.findByText('Add a parent first')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add sibling' })).toBeNull();
  });
});
