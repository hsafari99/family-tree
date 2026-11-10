import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthContext';
import { gu } from '../../canvas/test-fixtures';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson, fakePersonView } from '../../test/fake-trees';
import { TreesApiProvider } from '../../trees/TreesApiContext';
import { UnionPanel } from './UnionPanel';

const robert = fakePerson({ id: 'robert', givenName: 'Robert', surname: 'Hale' });
const margaret = fakePerson({ id: 'margaret', givenName: 'Margaret', surname: 'Hale' });

function setup(union: ReturnType<typeof gu> | undefined, loading = false) {
  const trees = new FakeTreesApi();
  const id = trees.addTree({ persons: [robert, margaret] });
  trees.trees.get(id)!.people.set(
    'robert',
    fakePersonView(robert, {
      relations: {
        parents: [],
        siblings: [],
        unions: [
          {
            id: 'u-rm',
            type: 'marriage',
            status: 'widowed',
            startDate: null,
            endDate: null,
            partner: margaret,
            children: [],
          },
        ],
      },
    }),
  );
  const onChanged = vi.fn();
  render(
    <AuthProvider api={new FakeAuthApi()}>
      <TreesApiProvider api={trees}>
        <MemoryRouter>
          <UnionPanel
            treeId={id}
            union={union}
            loading={loading}
            persons={[robert, margaret]}
            onChanged={onChanged}
          />
        </MemoryRouter>
      </TreesApiProvider>
    </AuthProvider>,
  );
  return { trees, id, onChanged };
}
const rm = (extra = {}) => gu('u-rm', 'robert', 'margaret', { status: 'widowed', ...extra });

describe('UnionPanel', () => {
  it('shows the partners, type and status', () => {
    setup(rm());
    expect(screen.getByText('Robert Hale and Margaret Hale')).toBeInTheDocument();
    expect(screen.getByText('Marriage, Widowed')).toBeInTheDocument();
  });

  it('edits the status', async () => {
    const s = setup(rm());
    fireEvent.click(screen.getByRole('button', { name: 'Edit relationship' }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'divorced' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save relationship' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(s.trees.callsTo('updateUnion')).toEqual([
      { treeId: s.id, unionId: 'u-rm', input: { status: 'divorced' } },
    ]);
    await waitFor(() => expect(s.onChanged).toHaveBeenCalled());
  });

  it('has no edit button without permission', () => {
    setup(rm({ canEdit: false }));
    expect(screen.queryByRole('button', { name: 'Edit relationship' })).toBeNull();
  });

  it('says so when the union is not in the view', () => {
    setup(undefined);
    expect(screen.getByText('This relationship isn’t in the current view.')).toBeInTheDocument();
  });
});
