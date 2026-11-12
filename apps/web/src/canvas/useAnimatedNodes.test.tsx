import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from './graph-to-flow';
import { gp } from './test-fixtures';
import { ANIMATE_BELOW, useAnimatedNodes } from './useAnimatedNodes';

const node = (id: string, x: number, className?: string): CanvasNode => ({
  id,
  type: 'person',
  position: { x, y: 0 },
  data: {
    person: gp(id, id, null),
    isFocus: false,
    isMe: false,
    reorderUnionId: null,
    coupleDrag: false,
    branch: null,
  },
  ...(className ? { className } : {}),
});

let frames: FrameRequestCallback[] = [];
const runFrame = (now: number) =>
  act(() => {
    const due = frames;
    frames = [];
    for (const f of due) f(now);
  });
const stubMotion = (reduce: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({ matches: reduce && q.includes('reduce'), media: q })),
  );

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
  vi.stubGlobal('cancelAnimationFrame', () => void (frames = []));
  stubMotion(false);
});
afterEach(() => vi.unstubAllGlobals());

const x = (ns: CanvasNode[], id: string) => ns.find((n) => n.id === id)!.position.x;

describe('useAnimatedNodes', () => {
  it('shows the first layout straight away', () => {
    const first = [node('a', 0)];
    const { result } = renderHook(() => useAnimatedNodes(first));
    expect(result.current.shown).toBe(first);
    expect(frames).toHaveLength(0);
  });

  it('glides to a new layout, then settles on it', async () => {
    const first = [node('a', 0)];
    const next = [node('a', 100), node('b', 50)];
    const { result, rerender } = renderHook(({ ns }) => useAnimatedNodes(ns, { duration: 300 }), {
      initialProps: { ns: first },
    });
    rerender({ ns: next });
    let settled = false;
    void result.current.settled().then(() => (settled = true));
    runFrame(1000);
    expect(x(result.current.shown, 'a')).toBe(0);
    runFrame(1150);
    const mid = x(result.current.shown, 'a');
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(100);
    expect(result.current.shown.find((n) => n.id === 'b')!.className).toBe('is-entering');
    runFrame(1300);
    expect(result.current.shown).toBe(next);
    await act(async () => {});
    expect(settled).toBe(true);
  });

  it('jumps with reduced motion', () => {
    stubMotion(true);
    const { result, rerender } = renderHook(({ ns }) => useAnimatedNodes(ns), {
      initialProps: { ns: [node('a', 0)] },
    });
    const next = [node('a', 100)];
    rerender({ ns: next });
    expect(result.current.shown).toBe(next);
    expect(frames).toHaveLength(0);
  });

  it('jumps on a class-only change and on a large tree', () => {
    const { result, rerender } = renderHook(({ ns }) => useAnimatedNodes(ns), {
      initialProps: { ns: [node('a', 0)] },
    });
    const dim = [node('a', 0, 'is-dim')];
    rerender({ ns: dim });
    expect(result.current.shown).toBe(dim);
    const big = Array.from({ length: ANIMATE_BELOW }, (_, i) => node(`n${i}`, i));
    rerender({ ns: big });
    expect(result.current.shown).toBe(big);
    expect(frames).toHaveLength(0);
  });
});
