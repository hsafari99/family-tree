import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakeLayoutEngine } from '../test/fake-layout';
import { applyElkLayout, toElkGraph } from './elk-graph';
import { FamilyCanvas } from './FamilyCanvas';
import { graphToFlow } from './graph-to-flow';
import { haleGraph } from './test-fixtures';

const fits = vi.fn();
// Count fitView calls: wrap the (memoised) instance once, so its identity stays stable.
vi.mock('@xyflow/react', async (orig) => {
  const mod = await orig<typeof import('@xyflow/react')>();
  const cache = new WeakMap<object, unknown>();
  return {
    ...mod,
    useReactFlow: () => {
      const f = mod.useReactFlow();
      if (!cache.has(f))
        cache.set(f, {
          ...f,
          fitView: (...a: Parameters<typeof f.fitView>) => {
            fits();
            return f.fitView(...a);
          },
        });
      return cache.get(f);
    },
  };
});

async function laidOut() {
  const flow = graphToFlow(haleGraph(), { focusId: null, meId: null });
  const laid = await new FakeLayoutEngine().layout(toElkGraph(flow, null));
  return { ...flow, nodes: applyElkLayout(flow.nodes, laid, flow.couples, flow.blood) };
}
const actions = { openPerson: vi.fn(), addRelative: vi.fn(), openUnion: vi.fn() };
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (k: number) => (k === 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

describe('FamilyCanvas refit', () => {
  it('fits after a new layout, but not when only classes change', async () => {
    const flow = await laidOut();
    const props = { ...flow, focusId: null, actions, selectedId: null };
    const { rerender } = render(<FamilyCanvas {...props} layoutKey={1} />);
    await screen.findAllByRole('button', { hidden: true });
    await vi.waitFor(() => expect(fits).toHaveBeenCalled());
    await frames(4);
    const after = fits.mock.calls.length;
    // A highlight: new node objects with an added class, same layout.
    const dimmed = flow.nodes.map((n) => ({ ...n, className: 'is-dim' }));
    rerender(<FamilyCanvas {...props} nodes={dimmed} layoutKey={1} />);
    await frames(4);
    expect(fits).toHaveBeenCalledTimes(after);
    rerender(<FamilyCanvas {...props} nodes={[...flow.nodes]} layoutKey={2} />);
    await vi.waitFor(() => expect(fits.mock.calls.length).toBeGreaterThan(after));
  });
});
