import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../auth/AuthContext';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi } from '../../test/fake-trees';
import { TreesApiProvider } from '../../trees/TreesApiContext';
import { haleGraph } from '../test-fixtures';
import { useTreeAnchor } from './useTreeAnchor';

describe('useTreeAnchor', () => {
  const setup = () => {
    const trees = new FakeTreesApi();
    const id = trees.addTree({});
    const g = haleGraph();
    trees.trees.get(id)!.graph = {
      ...g,
      mode: 'ancestors',
      persons: g.persons.map((p) =>
        p.id === 'robert' || p.id === 'david' ? { ...p, sex: 'male' as const } : p,
      ),
    };
    return { trees, id };
  };
  it('climbs the first parent’s line, at most gens - 1 steps', async () => {
    const s = setup();
    const out = { id: null as string | null };
    const auth = new FakeAuthApi();
    const view = (gens: number) => (
      <AuthProvider api={auth}>
        <TreesApiProvider api={s.trees}>
          <ProbeFor treeId={s.id} gens={gens} out={out} />
        </TreesApiProvider>
      </AuthProvider>
    );
    const { rerender } = render(view(4));
    await waitFor(() => expect(out.id).toBe('robert'));
    expect(s.trees.callsTo('getGraph')[0]).toMatchObject({
      query: { mode: 'ancestors', focus: 'leo', generations: 3 },
    });
    rerender(view(2));
    await waitFor(() => expect(out.id).toBe('david'));
    rerender(view(1));
    await waitFor(() => expect(out.id).toBe('leo'));
  });
});

function ProbeFor({
  treeId,
  gens,
  out,
}: {
  treeId: string;
  gens: number;
  out: { id: string | null };
}) {
  out.id = useTreeAnchor(treeId, 'leo', gens, true);
  return null;
}
