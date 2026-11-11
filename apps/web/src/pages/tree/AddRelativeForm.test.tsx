import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../auth/api';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson, fakePersonView } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

const subject = fakePerson({ givenName: 'Ann', surname: 'Hale' });
const pat = fakePerson({ givenName: 'Pat', surname: 'Moss' });
const zed = fakePerson({ givenName: 'Zed', surname: 'Other' });
const root = fakePerson({ givenName: 'Root' });
const UNION = crypto.randomUUID();

function setup(withUnion = true) {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
  const trees = new FakeTreesApi();
  const id = trees.addTree({ persons: [{ ...root }, { ...subject }, { ...pat }, { ...zed }] });
  const view = fakePersonView(subject);
  if (withUnion) {
    view.relations.unions.push({
      id: UNION,
      type: 'marriage',
      status: 'married',
      startDate: null,
      endDate: null,
      partner: pat,
      children: [],
    });
  }
  trees.trees.get(id)!.people.set(subject.id, view);
  return { auth, trees, id };
}

/** "Add child" -> the "Add relative" menu's "Child" item (brief #12). */
const addVia = async (button: string) => {
  fireEvent.click(await screen.findByRole('button', { name: 'Add relative' }));
  const item = button.replace(/^Add /, '');
  fireEvent.click(screen.getByRole('menuitem', { name: item[0]!.toUpperCase() + item.slice(1) }));
};
const open = async (s: ReturnType<typeof setup>, button: string) => {
  renderAt(`/trees/${s.id}/people/${subject.id}?tab=relations`, s);
  await addVia(button);
};

describe('AddRelativeForm', () => {
  it('adds a new child with the only partner preselected', async () => {
    const s = setup();
    await open(s, 'Add child');
    expect(screen.getByLabelText('Other parent')).toHaveDisplayValue('with Pat Moss');
    expect(screen.getByLabelText('Last name')).toHaveValue('Hale');
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Kit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(s.trees.callsTo('createPerson')[0]).toMatchObject({
      input: {
        person: { givenName: 'Kit', surname: 'Hale', sex: 'unknown' },
        attach: { to: subject.id, as: 'child', unionId: UNION, kind: 'biological' },
      },
    });
  });

  it('sends no unionId for an unknown other parent', async () => {
    const s = setup();
    await open(s, 'Add child');
    fireEvent.change(screen.getByLabelText('Other parent'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Kit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    const input = (s.trees.callsTo('createPerson')[0] as { input: { attach: object } }).input;
    expect(input.attach).toEqual({ to: subject.id, as: 'child', kind: 'biological' });
  });

  it('links an existing person as a partner', async () => {
    const s = setup(false);
    await open(s, 'Add partner');
    fireEvent.click(screen.getByLabelText('Someone already in the tree'));
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: zed.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(s.trees.callsTo('addRelative')).toHaveLength(1));
    expect(s.trees.callsTo('addRelative')[0]).toEqual({
      treeId: s.id,
      personId: subject.id,
      input: {
        personId: zed.id,
        as: 'partner',
        kind: 'biological',
        union: { type: 'marriage', status: 'married' },
      },
    });
  });

  it('shows the already-related message on a conflict', async () => {
    const s = setup(false);
    await open(s, 'Add partner');
    fireEvent.click(screen.getByLabelText('Someone already in the tree'));
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: zed.id } });
    s.trees.failNext('addRelative', {
      code: 'CONFLICT',
      message: 'They are already related this way',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('They are already related this way');
  });

  it('offers Add sibling with no parents recorded (brief #11)', async () => {
    const s = setup(false);
    renderAt(`/trees/${s.id}/people/${subject.id}?tab=relations`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Add relative' }));
    expect(screen.getByRole('menuitem', { name: 'Sibling' })).toBeEnabled();
    expect(screen.queryByText('Add a parent first')).toBeNull();
  });

  it('validates the first name without calling', async () => {
    const s = setup();
    await open(s, 'Add parent');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Enter a first name')).toBeInTheDocument();
    expect(s.trees.callsTo('createPerson')).toEqual([]);
  });
});

describe('AddRelativeForm duplicate check', () => {
  const ada = fakePerson({
    givenName: 'Ada',
    surname: 'Lovelace',
    birthYear: 1815,
    deathYear: 1852,
  });

  // The panel can reload once while the page settles (which resets an open form), so retry.
  async function openForm(s: ReturnType<typeof setup>) {
    renderAt(`/trees/${s.id}/people/${subject.id}?tab=relations`, s);
    await waitFor(() => {
      if (!screen.queryByLabelText('First name')) {
        if (!screen.queryByRole('menu')) {
          fireEvent.click(screen.getByRole('button', { name: 'Add relative' }));
        }
        fireEvent.click(screen.getByRole('menuitem', { name: 'Child' }));
      }
      expect(screen.getByLabelText('First name')).toBeInTheDocument();
    });
  }

  function dupSetup() {
    const s = setup();
    s.trees.trees.get(s.id)!.persons.push({ ...ada });
    return s;
  }
  const fillChild = (given: string, surname = 'Lovelace', year = '1815') => {
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: given } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: surname } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: year } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  };

  it('prompts on a match without creating anything', async () => {
    const s = dupSetup();
    await openForm(s);
    fillChild('Ada');
    expect(
      await screen.findByRole('button', { name: 'Yes, use Ada Lovelace' }),
    ).toBeInTheDocument();
    expect(s.trees.callsTo('findSimilar')).toHaveLength(1);
    expect(s.trees.callsTo('createPerson')).toHaveLength(0);
  });

  it('Yes links the existing person', async () => {
    const s = dupSetup();
    await openForm(s);
    fillChild('Ada');
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, use Ada Lovelace' }));
    await waitFor(() => expect(s.trees.callsTo('addRelative')).toHaveLength(1));
    expect(s.trees.callsTo('addRelative')[0]).toMatchObject({
      personId: subject.id,
      input: { personId: ada.id, as: 'child', kind: 'biological', unionId: UNION },
    });
    expect(s.trees.callsTo('createPerson')).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add child' })).toBeNull());
  });

  it('No creates exactly once, and the same name is not asked again', async () => {
    const s = dupSetup();
    await openForm(s);
    fillChild('Ada');
    fireEvent.click(await screen.findByRole('button', { name: 'No, add a new person' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(s.trees.callsTo('createPerson')[0]).toMatchObject({
      input: { person: { givenName: 'Ada', surname: 'Lovelace' } },
    });
    expect(s.trees.trees.get(s.id)!.persons.filter((p) => p.givenName === 'Ada')).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add child' })).toBeNull());
  });

  it('creates directly when nothing matches', async () => {
    const s = dupSetup();
    await openForm(s);
    fillChild('Zed', 'Quux', '2001');
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(s.trees.callsTo('findSimilar')).toHaveLength(1);
  });

  it('still creates when the check fails', async () => {
    const s = dupSetup();
    s.trees.failNext('findSimilar', { code: 'NETWORK', message: 'x' });
    await openForm(s);
    fillChild('Ada');
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
  });

  it('never offers the subject as a match', async () => {
    const s = dupSetup();
    await openForm(s);
    fillChild('Ann', 'Hale', '');
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /^Yes, use/ })).toBeNull();
  });

  it('checks again when the name changes after No', async () => {
    const s = dupSetup();
    s.trees.failNext('createPerson', { code: 'VALIDATION', message: 'nope' });
    await openForm(s);
    fillChild('Ada');
    fireEvent.click(await screen.findByRole('button', { name: 'No, add a new person' }));
    await screen.findByText('nope');
    expect(s.trees.callsTo('findSimilar')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Adah' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(s.trees.callsTo('findSimilar')).toHaveLength(2));
  });
});

describe('AddRelativeForm: adding a parent (brief #9)', () => {
  const mum = fakePerson({ givenName: 'Mia', surname: 'Hale' });
  const ben = fakePerson({ givenName: 'Ben', surname: 'Hale' });
  const U1 = crypto.randomUUID();
  const U2 = crypto.randomUUID();
  const LINK = crypto.randomUUID();
  function parentSetup(o: { known?: boolean; moveTo?: boolean; unknown?: boolean } = {}) {
    const auth = new FakeAuthApi();
    auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
    const trees = new FakeTreesApi();
    const id = trees.addTree({ persons: [{ ...root }, { ...subject }, { ...mum }, { ...ben }] });
    const view = fakePersonView(subject);
    if (o.known || o.unknown) {
      view.relations.parents.push({
        linkId: LINK,
        kind: 'biological',
        union: { id: U1, type: 'partnership', status: 'partners' },
        parents: o.known ? [mum] : [],
        moveTo: o.moveTo ? [{ unionId: U2, parents: [mum, ben] }] : [],
      });
    }
    trees.trees.get(id)!.people.set(subject.id, view);
    return { auth, trees, id };
  }

  it('offers "Partner of X" or a separate parent, and sends unionId null for the latter', async () => {
    const s = parentSetup({ known: true });
    await open(s, 'Add parent');
    const which = screen.getByLabelText('Which parents');
    expect([...which.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Partner of Mia Hale (parents together)',
      'Not Mia Hale’s partner (a separate parent)',
    ]);
    fireEvent.change(which, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Zoe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(s.trees.callsTo('createPerson')[0]).toMatchObject({
      input: { attach: { as: 'parent', unionId: null } },
    });
  });

  it('offers the siblings’ parents for a parents-unknown entry', async () => {
    const s = parentSetup({ unknown: true });
    await open(s, 'Add parent');
    const which = screen.getByLabelText('Which parents');
    expect([...which.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Parent of them and their siblings',
      'Only their parent',
    ]);
  });

  it('re-links to the couple with "Add as child of X and Y"', async () => {
    const s = parentSetup({ known: true, moveTo: true });
    await open(s, 'Add parent');
    expect(
      screen.getByRole('group', { name: 'Is the other parent already in the tree?' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add as child of Mia Hale and Ben Hale' }));
    await waitFor(() => expect(s.trees.callsTo('reparentLink')).toHaveLength(1));
    expect(s.trees.callsTo('reparentLink')[0]).toMatchObject({ linkId: LINK, unionId: U2 });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add parent' })).toBeNull());
  });

  it('shows the fixed message when the child is already in that couple', async () => {
    const s = parentSetup({ known: true, moveTo: true });
    s.trees.failNext('reparentLink', { code: 'CONFLICT', message: MESSAGES.alreadyChild });
    await open(s, 'Add parent');
    fireEvent.click(screen.getByRole('button', { name: 'Add as child of Mia Hale and Ben Hale' }));
    expect(await screen.findByText(MESSAGES.alreadyChild)).toBeInTheDocument();
  });

  it('adds both parents in one request', async () => {
    const s = parentSetup();
    await open(s, 'Add parent');
    expect(screen.queryByLabelText('Which parents')).toBeNull();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Mum' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add a second parent too' }));
    const second = within(screen.getByRole('group', { name: 'Second parent' }));
    fireEvent.change(second.getByLabelText('First name'), { target: { value: 'Dad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(s.trees.callsTo('createPerson')[0]).toMatchObject({
      input: {
        person: { givenName: 'Mum' },
        attach: { to: subject.id, as: 'parent' },
        coParent: { person: { givenName: 'Dad' } },
      },
    });
  });

  it('needs the second parent’s name, and points at it', async () => {
    const s = parentSetup();
    await open(s, 'Add parent');
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Mum' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add a second parent too' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const second = within(screen.getByRole('group', { name: 'Second parent' }));
    await waitFor(() =>
      expect(second.getByLabelText('First name')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(s.trees.callsTo('createPerson')).toHaveLength(0);
  });

  it('uses an existing first parent with a new second one', async () => {
    const s = parentSetup();
    await open(s, 'Add parent');
    fireEvent.click(screen.getByRole('radio', { name: 'Someone already in the tree' }));
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: mum.id } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add a second parent too' }));
    const second = within(screen.getByRole('group', { name: 'Second parent' }));
    fireEvent.change(second.getByLabelText('First name'), { target: { value: 'Dad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(s.trees.callsTo('createPerson')).toHaveLength(1));
    expect(s.trees.callsTo('createPerson')[0]).toMatchObject({
      input: { person: { givenName: 'Dad' }, coParent: { personId: mum.id } },
    });
  });
});
