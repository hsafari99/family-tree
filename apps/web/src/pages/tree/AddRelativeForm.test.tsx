import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

const open = async (s: ReturnType<typeof setup>, button: string) => {
  renderAt(`/trees/${s.id}/people/${subject.id}?tab=relations`, s);
  fireEvent.click(await screen.findByRole('button', { name: button }));
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

  it('disables Add sibling until a parent exists', async () => {
    const s = setup(false);
    renderAt(`/trees/${s.id}/people/${subject.id}?tab=relations`, s);
    expect(await screen.findByRole('button', { name: 'Add sibling' })).toBeDisabled();
    expect(screen.getByText('Add a parent first')).toBeInTheDocument();
  });

  it('validates the first name without calling', async () => {
    const s = setup();
    await open(s, 'Add parent');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Enter a first name')).toBeInTheDocument();
    expect(s.trees.callsTo('createPerson')).toEqual([]);
  });
});
