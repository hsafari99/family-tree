import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../auth/api';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson, fakePersonView } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

const ada = fakePerson({ givenName: 'Ada', surname: 'King', birthYear: 1950 });
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
const at = (s: { id: string }) => `/trees/${s.id}/people/${ada.id}?tab=places`;

/** Ada: born in Leeds in 1950, lived in York 1970–1980, died in Hull. */
function full() {
  const s = setup();
  Object.assign(s.view.person, {
    birthPlace: 'Leeds',
    birthDate: { qualifier: 'exact', date1: '1950' },
    deathPlace: 'Hull',
    deathDate: null,
    isLiving: false,
  });
  s.view.residences.push({
    id: crypto.randomUUID(),
    place: 'York',
    fromDate: { qualifier: 'exact', date1: '1970' },
    toDate: { qualifier: 'exact', date1: '1980' },
  });
  return s;
}
const rowsText = () =>
  within(screen.getByRole('list', { name: 'Places' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.row-main')!.textContent);

describe('PlacesTab (brief #7)', () => {
  it('lists born, lived and died rows, each with one menu, and a single Add place', async () => {
    const s = full();
    renderAt(at(s), s);
    await screen.findByRole('list', { name: 'Places' });
    expect(rowsText()).toEqual(['BornLeeds1950', 'LivedYork1970–1980', 'DeceasedHull']);
    for (const p of ['Leeds', 'York', 'Hull']) {
      expect(screen.getAllByRole('button', { name: `More actions for ${p}` })).toHaveLength(1);
    }
    expect(screen.getAllByRole('button', { name: 'Add place' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('keeps one form open at a time, with focus on its first field', async () => {
    const s = full();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Add place' }));
    expect(screen.getByRole('form', { name: 'Add place' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for York' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(screen.queryByRole('form', { name: 'Add place' })).toBeNull();
    const form = screen.getByRole('form', { name: 'Edit lived here' });
    expect(within(form).getByLabelText('Place')).toHaveFocus();
    expect(within(form).getByLabelText('Place')).toHaveValue('York');
    fireEvent.change(within(form).getByLabelText('Place'), { target: { value: 'Ripon' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save place' }));
    await waitFor(() => expect(s.trees.callsTo('updateResidence')).toHaveLength(1));
    expect(s.trees.callsTo('updateResidence')[0]).toMatchObject({ input: { place: 'Ripon' } });
  });

  it('removes a birth place after the confirm step', async () => {
    const s = full();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Leeds' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(s.trees.callsTo('updatePerson')).toEqual([]);
    const yes = screen.getByRole('button', { name: 'Yes, remove' });
    expect(yes).toHaveFocus();
    fireEvent.click(yes);
    await waitFor(() => expect(s.trees.callsTo('updatePerson')).toHaveLength(1));
    expect(s.trees.callsTo('updatePerson')[0]).toMatchObject({ input: { birthPlace: null } });
  });

  it('cancelling a remove returns focus to the row menu', async () => {
    const s = full();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for York' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'More actions for York' })).toHaveFocus(),
    );
    expect(s.trees.callsTo('deleteResidence')).toEqual([]);
  });

  it('removes a residence', async () => {
    const s = full();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for York' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(s.trees.callsTo('deleteResidence')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('York')).toBeNull());
  });

  it('offers a birth or death kind only when none is set', async () => {
    const s = setup();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Add place' }));
    const kind = screen.getByLabelText('Kind');
    expect([...kind.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Lived here',
      'Birth place',
      'Death place',
    ]);
  });

  it('offers only Lived here when birth and death places are set', async () => {
    const f = full();
    renderAt(at(f), f);
    fireEvent.click(await screen.findByRole('button', { name: 'Add place' }));
    expect(screen.queryByLabelText('Kind')).toBeNull();
    expect(screen.getByRole('group', { name: 'From' })).toBeInTheDocument();
  });

  it('adds a residence and a birth place', async () => {
    const s = setup();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Add place' }));
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: 'Leeds' } });
    fireEvent.click(
      within(screen.getByRole('form', { name: 'Add place' })).getByRole('button', {
        name: 'Add place',
      }),
    );
    await waitFor(() => expect(s.trees.callsTo('addResidence')).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Add place' }));
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'birth' } });
    expect(screen.queryByLabelText('From')).toBeNull();
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: 'York' } });
    fireEvent.click(
      within(screen.getByRole('form', { name: 'Add place' })).getByRole('button', {
        name: 'Add place',
      }),
    );
    await waitFor(() => expect(s.trees.callsTo('updatePerson')).toHaveLength(1));
    expect(s.trees.callsTo('updatePerson')[0]).toMatchObject({ input: { birthPlace: 'York' } });
  });

  it('shows an error when a reload fails even though a view is loaded', async () => {
    const s = setup();
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Add place' }));
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: 'Leeds' } });
    s.trees.failNext('getPerson', { code: 'NOT_FOUND', message: MESSAGES.personNotFound });
    fireEvent.click(
      within(screen.getByRole('form', { name: 'Add place' })).getByRole('button', {
        name: 'Add place',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.personNotFound);
  });

  it('shows the list without menus or Add place to a viewer', async () => {
    const s = full();
    s.view.capabilities = { edit: false, addRelative: false, delete: false };
    renderAt(at(s), s);
    await screen.findByRole('list', { name: 'Places' });
    expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add place' })).toBeNull();
  });

  describe('the death place of a living person (brief #8)', () => {
    const LIVING_MSG =
      'This person is marked as living. To add a death place, tick the box below to mark them as deceased.';
    const living = () => {
      const s = setup();
      Object.assign(s.view.person, { isLiving: true, deathDate: null, deathPlace: null });
      return s;
    };
    const typeDeathPlace = async (s: ReturnType<typeof setup>) => {
      renderAt(at(s), s);
      fireEvent.click(await screen.findByRole('button', { name: 'Add place' }));
      fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'death' } });
      fireEvent.change(screen.getByLabelText('Place'), { target: { value: 'Leeds' } });
    };
    const submit = () =>
      fireEvent.click(
        within(screen.getByRole('form', { name: 'Add place' })).getByRole('button', {
          name: 'Add place',
        }),
      );

    it('explains the error at the place field and in the summary, without calling', async () => {
      const s = living();
      await typeDeathPlace(s);
      expect(screen.getByRole('checkbox', { name: 'Mark Ada as deceased' })).not.toBeChecked();
      submit();
      const summary = await screen.findByRole('alert');
      const link = within(summary).getByRole('button', { name: `Death place: ${LIVING_MSG}` });
      expect(screen.getByLabelText('Place')).toHaveAccessibleDescription(LIVING_MSG);
      expect(s.trees.callsTo('updatePerson')).toEqual([]);
      fireEvent.click(link);
      expect(screen.getByRole('checkbox', { name: 'Mark Ada as deceased' })).toHaveFocus();
    });

    it('maps the server’s isLiving key onto the box', async () => {
      const s = living();
      await typeDeathPlace(s);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark Ada as deceased' }));
      s.trees.failNext('updatePerson', {
        code: 'VALIDATION',
        message: MESSAGES.checkDetails,
        fields: ['isLiving'],
      });
      submit();
      await waitFor(() =>
        expect(screen.getByLabelText('Place')).toHaveAccessibleDescription(LIVING_MSG),
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
      submit();
      expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGES.checkDetails);
    });

    it('ticking “Mark as deceased” saves the place and marks them deceased', async () => {
      const s = living();
      await typeDeathPlace(s);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark Ada as deceased' }));
      submit();
      expect(await screen.findByText('Saved')).toBeInTheDocument();
      expect(s.trees.callsTo('updatePerson')).toMatchObject([
        { input: { version: 1, deathPlace: 'Leeds', isLiving: false } },
      ]);
      expect(rowsText()).toEqual(['DeceasedLeeds']);
    });

    it('a deceased person gets no box', async () => {
      const s = setup();
      Object.assign(s.view.person, { isLiving: false, deathPlace: null });
      await typeDeathPlace(s);
      expect(screen.queryByRole('checkbox', { name: /as deceased/ })).toBeNull();
    });
  });
});
