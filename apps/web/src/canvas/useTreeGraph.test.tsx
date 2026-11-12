import { act, render, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeLayoutEngine } from '../test/fake-layout';
import { FakeTreesApi, fakePerson } from '../test/fake-trees';
import { TreesApiProvider } from '../trees/TreesApiContext';
import { LayoutEngineProvider } from './LayoutEngineContext';
import { haleGraph } from './test-fixtures';
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

  it('hides collapsed branches without fetching again, and marks the cards', async () => {
    const s = setup();
    s.trees.trees.get(s.a)!.graph = haleGraph();
    let hidden: ReadonlySet<string> = new Set();
    function Collapsing() {
      s.out.current = useTreeGraph(
        s.a,
        { mode: 'full' },
        { focusId: null, meId: null, hidden, anchorId: 'robert' },
        0,
      );
      return null;
    }
    const { rerender } = render(s.wrap(<Collapsing />));
    await waitFor(() => expect(s.out.current?.status).toBe('ready'));
    const card = (id: string) => {
      const st = s.out.current;
      if (st?.status !== 'ready') return undefined;
      const n = st.nodes.find((x) => x.id === `p:${id}`);
      return n?.type === 'person' ? n : undefined;
    };
    expect(card('david')?.data.branch).toEqual({ collapsed: false });
    expect(card('emma')?.data.branch).toBeNull();
    hidden = new Set(['david']);
    rerender(s.wrap(<Collapsing />));
    await waitFor(() => expect(card('emma')).toBeUndefined());
    expect(card('david')?.data.branch).toEqual({ collapsed: true, hidden: 3 });
    expect(s.trees.callsTo('getGraph')).toHaveLength(1);
    const st = s.out.current;
    expect(st?.status === 'ready' && st.hiddenBy.get('leo')).toEqual(['david']);
    // The rows of the drawing: Robert's generation on top, then David's.
    expect(st?.status === 'ready' && st.generations?.get('david')).toBe(1);
    expect(st?.status === 'ready' && st.rows.map((r) => r.generation)).toEqual([0, 1, 2]);
  });
});
