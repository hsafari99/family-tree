import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { TrashBatchDetail } from '@family-tree/shared';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeTreesApi, fakePerson } from '../test/fake-trees';
import { renderAt } from '../test/render';

const ada = fakePerson({ givenName: 'Ada', surname: 'King', birthYear: 1815, deathYear: 1852 });
const root = fakePerson({ givenName: 'Root' });

const batch = (
  over: Partial<TrashBatchDetail['batch']>,
  extra: Partial<TrashBatchDetail> = {},
): TrashBatchDetail => ({
  batch: {
    id: crypto.randomUUID(),
    mode: 'person',
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedBy: null,
    root: { kind: 'person', name: 'Ada King' },
    people: 1,
    unions: 0,
    links: 0,
    ...over,
  },
  people: [ada],
  unions: [],
  links: [],
  slots: 0,
  ...extra,
});

function setup(entries: TrashBatchDetail[] = [], owner = true) {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
  const trees = new FakeTreesApi();
  const id = trees.addTree({
    name: 'Hale family',
    persons: [{ ...root }],
    ...(owner
      ? {}
      : {
          role: 'editor' as const,
          detail: {
            capabilities: {
              editAnywhere: true,
              manageTree: false,
              invite: false,
              grantStewardship: false,
            },
          },
        }),
  });
  const t = trees.trees.get(id)!;
  t.trash.push(...entries);
  return { auth, trees, id, t };
}

describe('TrashPage', () => {
  it('labels each kind of batch and shows the counts', async () => {
    const s = setup([
      batch({}),
      batch({ mode: 'descendants', people: 3, unions: 1, links: 2 }),
      batch({
        mode: 'relation',
        people: 0,
        unions: 1,
        root: { kind: 'union', partners: ['A', 'B'] },
      }),
      batch({
        mode: 'relation',
        people: 0,
        links: 1,
        root: { kind: 'link', child: null, parents: ['A', 'B'] },
      }),
    ]);
    renderAt(`/trees/${s.id}/trash`, s);
    expect(await screen.findByText('Ada King')).toBeInTheDocument();
    expect(screen.getByText('Ada King and their descendants')).toBeInTheDocument();
    expect(screen.getByText('Relationship between A and B')).toBeInTheDocument();
    expect(screen.getByText('Someone as child of A and B')).toBeInTheDocument();
    expect(screen.getByText(/3 people · 1 relationship · 2 links/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Hale family' })).toBeInTheDocument();
  });

  it('titles siblings with unknown parents, in the list and the details (brief #11)', async () => {
    const s = setup([
      batch(
        {
          mode: 'relation',
          people: 0,
          unions: 1,
          links: 2,
          root: { kind: 'union', partners: [], parentsUnknown: true },
        },
        { people: [], unions: [{ id: crypto.randomUUID(), partners: [], parentsUnknown: true }] },
      ),
    ]);
    renderAt(`/trees/${s.id}/trash`, s);
    expect(await screen.findByText('Siblings with unknown parents')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    await waitFor(() =>
      expect(screen.getAllByText('Siblings with unknown parents')).toHaveLength(2),
    );
  });

  it('shows the details of a batch', async () => {
    const s = setup([batch({}, { slots: 1 })]);
    renderAt(`/trees/${s.id}/trash`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Show details' }));
    expect(await screen.findByText(/Ada King 1815–1852/)).toBeInTheDocument();
    expect(screen.getByText('1 partner slot to put back')).toBeInTheDocument();
  });

  it('restores a batch', async () => {
    const e = batch({});
    const s = setup([e]);
    s.t.trashPeople.set(e.batch.id, [ada]);
    renderAt(`/trees/${s.id}/trash`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Restored.')).toBeInTheDocument();
    expect(s.t.persons.map((p) => p.id)).toContain(ada.id);
    expect(screen.queryByText('Ada King')).not.toBeInTheDocument();
  });

  it('keeps the row and explains a restore conflict', async () => {
    const e = batch({});
    const s = setup([e]);
    s.trees.restoreConflicts.add(e.batch.id);
    renderAt(`/trees/${s.id}/trash`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(await screen.findByText(MESSAGES.restoreConflict)).toBeInTheDocument();
    expect(screen.getByText('Ada King')).toBeInTheDocument();
  });

  it('erases only after two clicks', async () => {
    const s = setup([batch({})]);
    renderAt(`/trees/${s.id}/trash`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Erase permanently' }));
    expect(s.trees.callsTo('eraseBatch')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, erase for good' }));
    expect(await screen.findByText('Erased.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Ada King')).not.toBeInTheDocument());
    expect(s.trees.callsTo('eraseBatch')).toHaveLength(1);
  });

  it('tells a non-owner that only the owner can open it', async () => {
    const s = setup([], false);
    renderAt(`/trees/${s.id}/trash`, s);
    expect(await screen.findByText(MESSAGES.trashOwnerOnly)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to/ })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/trash`, s);
    expect(await screen.findByText('The Trash is empty.')).toBeInTheDocument();
  });
});
