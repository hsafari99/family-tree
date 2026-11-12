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
    renderAt(at(s, '?tab=info'), s);
    expect(await screen.findByRole('heading', { name: /^Ada King/ })).toBeInTheDocument();
    expect(screen.getByText('about 1815')).toBeInTheDocument();
    const prose = screen.getByText(/second line/);
    expect(prose).toHaveClass('prose');
    expect(prose.textContent).toBe('<b>x</b>\nsecond line');
    expect(prose.querySelector('b')).toBeNull();
  });

  it('edits the surname and refreshes the list', async () => {
    const s = setup();
    renderAt(at(s, '?tab=info'), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(s.trees.callsTo('updatePerson')).toMatchObject([
      { input: { version: 1, surname: 'Lovelace' } },
    ]);
    const list = screen.getByRole('link', { name: /^Ada Lovelace/ });
    expect(list).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: /^Ada Lovelace/ })).toBeInTheDocument();
  });

  it('validates death before birth and living with a death date, without calling', async () => {
    const s = setup();
    s.view.person.birthDate = { qualifier: 'exact', date1: '1900' };
    renderAt(at(s, '?tab=info'), s);
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
      renderAt(at(s, '?tab=info'), s);
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
      renderAt(at(s, '?tab=info'), s);
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
    renderAt(at(s, '?tab=info'), s);
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
    renderAt(at(s, '?tab=info'), s);
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
    renderAt(at(s, '?tab=info'), s);
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
    renderAt(at(s, '?tab=info'), s);
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
    renderAt(at(s, '?tab=info'), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
    );
    expect(s.trees.callsTo('updatePerson')).toEqual([]);
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

  describe('sections open in a dialog (brief #15)', () => {
    it('lists the sections on one line each, with a count for places and photos', async () => {
      const s = setup();
      s.view.person.birthPlace = 'London';
      renderAt(at(s), s);
      const list = await screen.findByRole('list', { name: 'Sections for Ada King' });
      const rows = within(list).getAllByRole('button');
      expect(rows.map((r) => r.textContent)).toEqual([
        'Details',
        'Places, 1',
        'Photos',
        'Relations',
        'History',
      ]);
      expect(rows[1]!.querySelector('.section-row-count')).toHaveTextContent('1');
      expect(rows[0]).toHaveAttribute('aria-haspopup', 'dialog');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
    });

    it('opens a section in a dialog, deep-linked in the URL; X closes it and focus returns', async () => {
      const s = setup();
      const r = renderAt(at(s), s);
      const row = await screen.findByRole('button', { name: /^Places/ });
      fireEvent.click(row);
      const dialog = await screen.findByRole('dialog', { name: 'Places — Ada King' });
      expect(await within(dialog).findByText('No places added yet.')).toBeInTheDocument();
      expect(r.where()).toMatch(/[?&]tab=places/);
      const x = within(dialog).getByRole('button', { name: 'Close' });
      expect(document.activeElement).toBe(x);
      fireEvent.click(x);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(r.where()).not.toMatch(/tab=/);
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Places/ })),
      );
    });

    it('opens from ?tab= and closes on Escape, dropping tab and add from the URL', async () => {
      const s = setup();
      const r = renderAt(at(s, '?tab=history'), s);
      const dialog = await screen.findByRole('dialog', { name: 'History — Ada King' });
      expect(await within(dialog).findByText('No changes recorded yet.')).toBeInTheDocument();
      fireEvent(dialog, new Event('cancel', { cancelable: true }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(r.where()).not.toMatch(/tab=/);
      fireEvent.click(screen.getByRole('button', { name: /^Relations/ }));
      expect(await screen.findByRole('dialog', { name: 'Relations — Ada King' })).toBeVisible();
    });

    it('ignores an unknown ?tab=', async () => {
      const s = setup();
      renderAt(at(s, '?tab=nope'), s);
      await screen.findByRole('heading', { name: /^Ada King/ });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
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
            moveTo: [],
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
      expect(screen.getByText(/Marriage/)).toHaveTextContent('Marriage from 1970 (married)');
      expect(screen.getByRole('link', { name: 'Mia King' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sib King' })).toBeInTheDocument();
    });

    it('edits a union status', async () => {
      const s = withRelations();
      open(s);
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'More actions for the relationship with Pat Moss',
        }),
      );
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit relationship' }));
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
      fireEvent.click(await screen.findByRole('button', { name: 'More actions for Mia King' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Change link kind…' }));
      fireEvent.change(screen.getByLabelText('Link kind for Mia King'), {
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
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'More actions for the relationship with Pat Moss',
        }),
      );
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove relationship' }));
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
    const r = renderAt(at(s, '?tab=relations&add=child'), s);
    await screen.findByRole('form', { name: 'Add child' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // Opened by a card's "+", the dialog was just for the form: it closes too.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(r.where()).not.toMatch(/tab=|add=/);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Relations/ })),
    );
    // The parameter is gone too: opening another role starts clean.
    fireEvent.click(screen.getByRole('button', { name: /^Relations/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add relative' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Partner' }));
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
            moveTo: [],
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
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Leo King' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move later' }));
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
    const items = async (who: string) => {
      fireEvent.click(await screen.findByRole('button', { name: `More actions for ${who}` }));
      const labels = screen.getAllByRole('menuitem').map((m) => m.textContent);
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      return labels;
    };
    expect(await items('Leo King')).toEqual(['Change link kind…', 'Move later', 'Remove link']);
    expect(await items('Mia King')).toEqual(['Change link kind…', 'Move earlier', 'Remove link']);
    // Nothing to move outside a menu.
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
  });

  it('shows viewers neither button', async () => {
    const s = family('viewer');
    s.view.capabilities = { edit: false, addRelative: false, delete: false };
    renderAt(at(s, '?tab=relations'), s);
    await screen.findByRole('heading', { name: /^Ada King/ });
    expect(screen.queryByRole('button', { name: /^Move |^More actions/ })).toBeNull();
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
    const { container } = renderAt(at(s, '?tab=info'), s);
    await screen.findByRole('heading', { name: /^Ada King/ });
    expect(container.querySelector('img.panel-photo')).toHaveAttribute(
      'src',
      'https://photos.test/1/thumb',
    );
  });
});
