import { act, render, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeLayoutEngine } from '../test/fake-layout';
import { FakeTreesApi, fakePerson } from '../test/fake-trees';
import { TreesApiProvider } from '../trees/TreesApiContext';
import { LayoutEngineProvider } from './LayoutEngineContext';
import { type TreeGraphState, useTreeGraph } from './useTreeGraph';

function Probe({
  treeId,
  focus,
  out,
}: {
  treeId: string;
  focus?: string;
  out: { current: TreeGraphState | null };
}) {
  out.current = useTreeGraph(
    treeId,
    { mode: 'focus', ...(focus ? { focus } : {}), depth: 1 },
    { focusId: null, meId: null },
    0,
  );
  return null;
}

function setup() {
  const trees = new FakeTreesApi();
  const layout = new FakeLayoutEngine();
  const a = trees.addTree({ persons: [fakePerson({ givenName: 'A' })] });
  const b = trees.addTree({ persons: [fakePerson({ givenName: 'B' })] });
  const out: { current: TreeGraphState | null } = { current: null };
  const wrap = (children: ReactNode) => (
    <AuthProvider api={new FakeAuthApi()}>
      <TreesApiProvider api={trees}>
        <LayoutEngineProvider engine={layout}>{children}</LayoutEngineProvider>
      </TreesApiProvider>
    </AuthProvider>
  );
  return { trees, layout, a, b, out, wrap };
}

describe('useTreeGraph', () => {
  it('aborts the previous request when the query changes, and never lays out stale data', async () => {
    const s = setup();
    s.trees.hold('getGraph');
    const { rerender } = render(s.wrap(<Probe treeId={s.a} focus="x" out={s.out} />));
    await waitFor(() => expect(s.trees.callsTo('getGraph')).toHaveLength(1));
    const first = (s.trees.callsTo('getGraph')[0] as { signal?: AbortSignal }).signal;
    expect(first).toBeInstanceOf(AbortSignal);
    rerender(s.wrap(<Probe treeId={s.a} focus="y" out={s.out} />));
    await waitFor(() => expect(first!.aborted).toBe(true));
    await act(async () => s.trees.release());
    await waitFor(() => expect(s.out.current?.status).toBe('ready'));
    expect(s.layout.calls).toHaveLength(1); // the aborted one never reached the engine
  });

  it('goes back to loading when the tree changes', async () => {
    const s = setup();
    const { rerender } = render(s.wrap(<Probe treeId={s.a} out={s.out} />));
    await waitFor(() => expect(s.out.current?.status).toBe('ready'));
    s.trees.hold('getGraph');
    rerender(s.wrap(<Probe treeId={s.b} out={s.out} />));
    await waitFor(() => expect(s.out.current?.status).toBe('loading'));
    await act(async () => s.trees.release());
    await waitFor(() => expect(s.out.current?.status).toBe('ready'));
  });
});
