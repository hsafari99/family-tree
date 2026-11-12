import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson, fakePersonView } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

const root = fakePerson({ givenName: 'Root', surname: 'Person' });
const ada = fakePerson({ givenName: 'Ada', surname: 'King', birthYear: 1815, deathYear: 1852 });
const kid = fakePerson({ givenName: 'Kid', surname: 'King', birthYear: 1840, deathYear: null });

function setup(canDelete = true) {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
  const trees = new FakeTreesApi();
  const id = trees.addTree({ persons: [{ ...root }, { ...ada }, { ...kid }] });
  const t = trees.trees.get(id)!;
  t.people.set(
    ada.id,
    fakePersonView(ada, { capabilities: { edit: true, addRelative: true, delete: canDelete } }),
  );
  return { auth, trees, id, t };
}
const preview = (over: object) => ({
  mode: 'person' as const,
  people: [ada],
  unions: 0,
  links: 0,
  outsideScope: 0,
  blockedByRoot: false,
  allowed: true,
  ...over,
});
const openDelete = async (s: ReturnType<typeof setup>) => {
  renderAt(`/trees/${s.id}/people/${ada.id}?tab=info`, s);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete this person…' }));
};

describe('DeletePerson', () => {
  it('loads a person-mode preview when opened', async () => {
    const s = setup();
    await openDelete(s);
    expect(await screen.findByText('This moves 1 person to the Trash:')).toBeInTheDocument();
    expect(s.trees.callsTo('previewDelete')).toEqual([
      { treeId: s.id, personId: ada.id, mode: 'person' },
    ]);
    expect(screen.getByText(/Relatives stay in the tree/)).toBeInTheDocument();
  });

  it('previews descendants when the mode changes', async () => {
    const s = setup();
    s.t.previews.set(
      `${ada.id}:descendants`,
      preview({ mode: 'descendants', people: [ada, kid], unions: 1, links: 1 }),
    );
    await openDelete(s);
    await screen.findByText('This moves 1 person to the Trash:');
    fireEvent.click(screen.getByLabelText('This person and their descendants'));
    expect(await screen.findByText('This moves 2 people to the Trash:')).toBeInTheDocument();
    expect(
      screen.getByText('1 relationship ends and 1 parent–child link is removed.'),
    ).toBeInTheDocument();
    expect(s.trees.callsTo('previewDelete')[1]).toMatchObject({ mode: 'descendants' });
  });

  it('blocks and explains when people are outside the steward’s branch', async () => {
    const s = setup();
    s.t.previews.set(ada.id, preview({ outsideScope: 2, allowed: false }));
    await openDelete(s);
    expect(
      await screen.findByText(
        'This includes 2 people outside your branch. Ask the owner to delete it.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move to Trash' })).not.toBeInTheDocument();
  });

  it('blocks deleting the starting person', async () => {
    const s = setup();
    s.t.previews.set(ada.id, preview({ blockedByRoot: true, allowed: false }));
    await openDelete(s);
    expect(await screen.findByText(/This includes the tree’s starting person/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move to Trash' })).not.toBeInTheDocument();
  });

  it('moves the person to the Trash after confirming and shows a notice', async () => {
    const s = setup();
    await openDelete(s);
    await screen.findByText('This moves 1 person to the Trash:');
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));
    expect(s.trees.callsTo('deletePerson')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, move to Trash' }));
    expect(
      await screen.findByText('Moved to Trash. The owner can restore it from the Trash.'),
    ).toBeInTheDocument();
    expect(s.trees.callsTo('deletePerson')).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'People (2)' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: /Ada King/ })).not.toBeInTheDocument();
  });

  it('shows the fixed message when the server refuses', async () => {
    const s = setup();
    await openDelete(s);
    await screen.findByText('This moves 1 person to the Trash:');
    s.trees.failNext('deletePerson', {
      code: 'FORBIDDEN',
      message: 'This includes people outside your branch. Ask the owner to delete it.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, move to Trash' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outside your branch');
  });

  it('has no Delete button without the capability', async () => {
    const s = setup(false);
    renderAt(`/trees/${s.id}/people/${ada.id}?tab=info`, s);
    await screen.findByRole('heading', { name: /Ada King/ });
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it('Edit and Delete share one row; Delete opens the options below it, with focus inside', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/${ada.id}?tab=info`, s);
    const del = await screen.findByRole('button', { name: 'Delete this person…' });
    const edit = screen.getByRole('button', { name: 'Edit details' });
    expect(edit).toHaveTextContent(/^Edit/);
    expect(del).toHaveTextContent(/^Delete/);
    expect(edit.parentElement).toBe(del.parentElement);
    expect(edit.parentElement).toHaveClass('detail-actions');
    expect(screen.queryByRole('heading', { name: 'Delete this person' })).toBeNull();
    expect(del).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(del);
    expect(del).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getByRole('group', { name: 'What to delete' });
    await waitFor(() => expect(options.contains(document.activeElement)).toBe(true));
    // Below the row.
    expect(del.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'What to delete' })).toBeNull();
    expect(del).toHaveFocus();
    // Edit opens the form and hides the row.
    fireEvent.click(edit);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this person…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
  });
});
