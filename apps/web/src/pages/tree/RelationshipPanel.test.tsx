import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Sex, TreeDetail } from '@family-tree/shared';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthContext';
import { MESSAGES } from '../../auth/api';
import { gp, haleGraph } from '../../canvas/test-fixtures';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson } from '../../test/fake-trees';
import { TreesApiProvider } from '../../trees/TreesApiContext';
import { RelationshipPanel } from './RelationshipPanel';

const SEX: Record<string, Sex> = {
  robert: 'male',
  margaret: 'female',
  david: 'male',
  susan: 'female',
  anna: 'female',
  laura: 'female',
  emma: 'female',
  leo: 'male',
  mia: 'female',
  noah: 'male',
};
const hale = haleGraph();
hale.persons = hale.persons.map((p) => ({ ...p, sex: SEX[p.id] ?? 'unknown' }));
const summaries = hale.persons.map(({ id, givenName, surname, birthYear, deathYear, isLiving }) =>
  fakePerson({ id, givenName, surname, birthYear, deathYear, isLiving, middleName: null }),
);
const lone = fakePerson({ id: 'lone', givenName: 'Lone', surname: 'Wolf' });

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function setup(url: string, meId: string | null = 'leo') {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
  const trees = new FakeTreesApi();
  const persons = [...summaries, lone];
  const id = trees.addTree({
    persons,
    detail: { me: { role: 'owner', personId: meId, steward: { grants: [], active: false } } },
  });
  trees.trees.get(id)!.graph = {
    ...hale,
    persons: [...hale.persons, gp('lone', 'Lone', null, { surname: 'Wolf' })],
    mode: 'full',
  };
  trees.trees.get(id)!.persons = persons;
  const detail: TreeDetail = trees.trees.get(id)!.detail;
  const onShow = vi.fn();
  render(
    <AuthProvider api={auth}>
      <TreesApiProvider api={trees}>
        <MemoryRouter initialEntries={[url.replace('$ID', id)]}>
          <RelationshipPanel treeId={id} detail={detail} persons={persons} onShow={onShow} />
          <Where />
        </MemoryRouter>
      </TreesApiProvider>
    </AuthProvider>,
  );
  return { trees, id, onShow };
}

describe('RelationshipPanel', () => {
  it('defaults From to you and words the relationship with the path', async () => {
    const s = setup('/trees/$ID/relationship?to=emma');
    expect(await screen.findByText('Emma Hale is your half-sister.')).toBeInTheDocument();
    expect(s.trees.callsTo('relationship')[0]).toMatchObject({ from: 'leo', to: 'emma' });
    const list = screen.getByRole('list', { name: 'People on the path' });
    expect(
      within(list)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Leo Hale', 'David Hale', 'Emma Hale']);
    expect(within(list).getByRole('link', { name: 'David Hale' })).toHaveAttribute(
      'href',
      expect.stringContaining('/people/david'),
    );
  });

  it('words it from someone else, with the chain', async () => {
    setup('/trees/$ID/relationship?from=noah&to=laura');
    expect(
      await screen.findByText('Laura Chen is Noah Hale’s aunt by marriage.'),
    ).toBeInTheDocument();
    expect(screen.getByText('The path: Noah Hale’s mother’s brother’s wife')).toBeInTheDocument();
  });

  it('shows just the chain when no term exists', async () => {
    setup('/trees/$ID/relationship?from=anna&to=laura');
    const headline = await screen.findByText(/^Laura Chen is /);
    expect(headline.textContent).toMatch(/Anna Berg’s/);
    expect(screen.queryByText(/^The path:/)).toBeNull();
  });

  it('says when there is no path or the people are the same', async () => {
    setup('/trees/$ID/relationship?to=lone');
    expect(await screen.findByText(MESSAGES.noRelationship)).toBeInTheDocument();
  });

  it('says it is the same person', async () => {
    setup('/trees/$ID/relationship?to=leo');
    expect(await screen.findByText('That’s the same person.')).toBeInTheDocument();
  });

  it('changes the target through the picker and replaces the URL', async () => {
    setup('/trees/$ID/relationship?to=emma');
    await screen.findByText('Emma Hale is your half-sister.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Change' })[1]!);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Mia' } });
    fireEvent.click(screen.getByRole('button', { name: /^Mia Hale/ }));
    expect(await screen.findByText('Mia Hale is your sister.')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toContain('to=mia');
  });

  it('calls onShow with the path', async () => {
    const s = setup('/trees/$ID/relationship?to=emma');
    fireEvent.click(await screen.findByRole('button', { name: 'Show on the tree' }));
    expect(s.onShow).toHaveBeenCalledTimes(1);
    expect(s.onShow.mock.calls[0]![0]).toBe('leo');
    expect(s.onShow.mock.calls[0]![1]).toHaveLength(2);
  });

  it('shows a fixed message when a person is not found', async () => {
    setup('/trees/$ID/relationship?to=ghost');
    expect(await screen.findByText(MESSAGES.personNotFound)).toBeInTheDocument();
  });
});
