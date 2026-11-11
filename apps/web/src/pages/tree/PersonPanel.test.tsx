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
    const died = within(screen.getByRole('group', { name: 'Died' }));
    fireEvent.change(died.getByLabelText('Precision'), { target: { value: 'year' } });
    const deathYear = died.getByLabelText('Year');
    fireEvent.change(deathYear, { target: { value: '1800' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Living' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Death can’t be before birth')).toBeInTheDocument();
    expect(s.trees.callsTo('updatePerson')).toEqual([]);
    fireEvent.change(deathYear, { target: { value: '1950' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Someone with death details can’t be marked as living'),
    ).toBeInTheDocument();
    expect(s.trees.callsTo('updatePerson')).toEqual([]);
  });

  describe('a birth or death date in the future', () => {
    const next = String(new Date().getUTCFullYear() + 1);
    const editDeathYear = async (s: ReturnType<typeof setup>, year: string) => {
      renderAt(at(s), s);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
      const died = within(screen.getByRole('group', { name: 'Died' }));
      fireEvent.change(died.getByLabelText('Precision'), { target: { value: 'year' } });
      fireEvent.change(died.getByLabelText('Year'), { target: { value: year } });
    };

    it('is refused with a fixed message, without calling', async () => {
      const s = setup();
      await editDeathYear(s, next);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      const summary = await screen.findByRole('alert');
      expect(
        within(summary).getByRole('button', { name: 'Died: That date is in the future' }),
      ).toBeInTheDocument();
      expect(s.trees.callsTo('updatePerson')).toEqual([]);
    });

    it('a server deathDate key gets our own text, which covers the future too', async () => {
      const s = setup();
      await editDeathYear(s, '1853');
      s.trees.failNext('updatePerson', {
        code: 'VALIDATION',
        message: MESSAGES.checkDetails,
        fields: ['deathDate'],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(
        await screen.findByText('Check the death date. It can’t be before birth or in the future.'),
      ).toBeInTheDocument();
    });

    it('a stored future birth date doesn’t block an unrelated edit', async () => {
      const s = setup();
      Object.assign(s.view.person, {
        birthDate: { qualifier: 'exact', date1: next },
        deathDate: null,
        isLiving: true,
      });
      renderAt(at(s), s);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
      fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Saved')).toBeInTheDocument();
      expect(s.trees.callsTo('updatePerson')).toMatchObject([
        { input: { version: 1, surname: 'Lovelace' } },
      ]);
    });
  });

  it('saves with a stored mixed-precision range left unchanged', async () => {
    const s = setup();
    s.view.person.birthDate = { qualifier: 'between', date1: '1815-06', date2: '1815' };
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(s.trees.callsTo('updatePerson')).toMatchObject([
      { input: { version: 1, surname: 'Lovelace' } },
    ]);
  });

  it('explains an incomplete date in plain words, without calling', async () => {
    const s = setup();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    const died = within(screen.getByRole('group', { name: 'Died' }));
    fireEvent.change(died.getByLabelText('Precision'), { target: { value: 'month' } });
    fireEvent.change(died.getByLabelText('Year'), { target: { value: '2001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose a month')).toBeInTheDocument();
    expect(s.trees.callsTo('updatePerson')).toEqual([]);
    const summary = screen.getByRole('alert');
    fireEvent.click(within(summary).getByRole('button', { name: 'Died: Choose a month' }));
    expect(died.getByLabelText('Year')).toHaveFocus();
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

  describe('the death place of a living person (brief #8)', () => {
    const living = () => {
      const s = setup();
      Object.assign(s.view.person, { isLiving: true, deathDate: null, deathPlace: null });
      return s;
    };
    const typeDeathPlace = async (s: ReturnType<typeof setup>) => {
      renderAt(at(s, '?tab=places'), s);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit places' }));
      fireEvent.change(screen.getByLabelText('Death place'), { target: { value: 'Leeds' } });
    };
    const LIVING_MSG =
      'This person is marked as living. To add a death place, tick the box below to mark them as deceased.';

    it('explains the error at the Death place field and in the summary, without calling', async () => {
      const s = living();
      await typeDeathPlace(s);
      expect(screen.getByRole('checkbox', { name: 'Mark Ada as deceased' })).not.toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: 'Save places' }));
      const summary = await screen.findByRole('alert');
      expect(
        within(summary).getByRole('button', { name: `Death place: ${LIVING_MSG}` }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Death place')).toHaveAccessibleDescription(LIVING_MSG);
      expect(s.trees.callsTo('updatePerson')).toEqual([]);
      // The fix is the box, so the summary link goes there.
      fireEvent.click(within(summary).getByRole('button', { name: `Death place: ${LIVING_MSG}` }));
      expect(screen.getByRole('checkbox', { name: 'Mark Ada as deceased' })).toHaveFocus();
    });

    it('maps the server’s isLiving key onto the Death place field', async () => {
      const s = living();
      await typeDeathPlace(s);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark Ada as deceased' }));
      s.trees.failNext('updatePerson', {
        code: 'VALIDATION',
        message: MESSAGES.checkDetails,
        fields: ['isLiving'],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save places' }));
      await waitFor(() =>
        expect(screen.getByLabelText('Death place')).toHaveAccessibleDescription(LIVING_MSG),
      );
      expect(screen.queryByText(MESSAGES.checkDetails)).toBeNull();
    });

    it('a key the form doesn’t show goes to the summary as the generic message', async () => {
      const s = living();
      await typeDeathPlace(s);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark Ada as deceased' }));
      s.trees.failNext('updatePerson', {
        code: 'VALIDATION',
        message: MESSAGES.checkDetails,
        fields: ['zzz'],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save places' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.checkDetails);
    });

    it('ticking “Mark as deceased” saves the place and marks them deceased', async () => {
      const s = living();
      await typeDeathPlace(s);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark Ada as deceased' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save places' }));
      expect(await screen.findByText('Saved')).toBeInTheDocument();
      expect(s.trees.callsTo('updatePerson')).toMatchObject([
        { input: { version: 1, deathPlace: 'Leeds', isLiving: false } },
      ]);
      expect(s.view.person).toMatchObject({ deathPlace: 'Leeds', isLiving: false });
      expect(screen.getByText('Leeds')).toBeInTheDocument();
    });

    it('a deceased person gets no box', async () => {
      const s = setup();
      Object.assign(s.view.person, { isLiving: false, deathPlace: null });
      await typeDeathPlace(s);
      expect(screen.queryByRole('checkbox', { name: /as deceased/ })).toBeNull();
    });
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
    expect(screen.getByText('No photos yet.')).toBeInTheDocument();
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

  it('opens Add sibling for add=sibling even when there are no parents (brief #11)', async () => {
    const s = setup();
    renderAt(at(s, '?tab=relations&add=sibling'), s);
    expect(await screen.findByRole('form', { name: 'Add sibling' })).toBeInTheDocument();
    expect(screen.queryByText('Add a parent first')).toBeNull();
  });

  it('labels a parents-unknown entry "Parents unknown" (brief #11)', async () => {
    const s = setup({
      relations: {
        parents: [
          {
            linkId: crypto.randomUUID(),
            kind: 'biological',
            union: { id: crypto.randomUUID(), type: 'partnership', status: 'partners' },
            parents: [],
          },
        ],
        unions: [],
        siblings: [],
      },
    });
    renderAt(at(s, '?tab=relations'), s);
    expect(await screen.findByText('Parents unknown', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Unknown parent', { exact: false })).toBeNull();
  });
});

describe('PersonPanel reorder children', () => {
  const leo = fakePerson({ givenName: 'Leo', surname: 'King', birthYear: 1994, deathYear: null });
  const mia = fakePerson({ givenName: 'Mia', surname: 'King', birthYear: 1996, deathYear: null });
  function family(role: 'owner' | 'viewer' = 'owner') {
    const s = setup({}, role);
    s.trees.trees.get(s.id)!.persons.push({ ...leo }, { ...mia });
    s.view.relations.unions.push({
      id: 'u-dl',
      type: 'marriage',
      status: 'married',
      startDate: null,
      endDate: null,
      partner: null,
      children: [
        { linkId: crypto.randomUUID(), kind: 'biological', person: leo },
        { linkId: crypto.randomUUID(), kind: 'biological', person: mia },
      ],
    });
    return s;
  }

  it('Move later swaps the two and reloads', async () => {
    const s = family();
    renderAt(at(s, '?tab=relations'), s);
    const before = s.trees.callsTo('getPerson').length;
    fireEvent.click(await screen.findByRole('button', { name: 'Move Leo King later' }));
    await waitFor(() => expect(s.trees.callsTo('reorderChildren')).toHaveLength(1));
    expect(s.trees.callsTo('reorderChildren')[0]).toEqual({
      treeId: s.id,
      unionId: 'u-dl',
      childIds: [mia.id, leo.id],
    });
    await waitFor(() => expect(s.trees.callsTo('getPerson').length).toBeGreaterThan(before));
    expect(await screen.findByText('Order saved.')).toBeInTheDocument();
  });

  it('has no Move earlier on the first or Move later on the last', async () => {
    const s = family();
    renderAt(at(s, '?tab=relations'), s);
    await screen.findByRole('button', { name: 'Move Leo King later' });
    expect(screen.queryByRole('button', { name: 'Move Leo King earlier' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move Mia King later' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Mia King earlier' })).toBeInTheDocument();
  });

  it('shows viewers neither button', async () => {
    const s = family('viewer');
    s.view.capabilities = { edit: false, addRelative: false, delete: false };
    renderAt(at(s, '?tab=relations'), s);
    await screen.findByRole('heading', { name: /Ada King/ });
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
  });

  it('shows the main photo in the header', async () => {
    const s = setup({
      photos: [
        {
          id: 'ph-1',
          width: 1,
          height: 1,
          bytes: 1,
          isPrimary: true,
          createdAt: new Date().toISOString(),
          uploadedByName: null,
          thumbUrl: 'https://photos.test/1/thumb',
          fullUrl: 'https://photos.test/1/full',
        },
      ],
    });
    const { container } = renderAt(at(s), s);
    await screen.findByRole('heading', { name: /Ada King/ });
    expect(container.querySelector('img.panel-photo')).toHaveAttribute(
      'src',
      'https://photos.test/1/thumb',
    );
  });
});
