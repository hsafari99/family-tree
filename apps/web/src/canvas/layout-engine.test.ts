import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createWorkerLayoutEngine,
  type ElkLike,
  LayoutSupersededError,
  LayoutTimeoutError,
} from './layout-engine';

const graph = (id: string): ElkNode => ({ id, children: [] });

/** An ELK whose layouts finish when the test says so. */
function controlled() {
  const open: { id: string; done: (g: ElkNode) => void }[] = [];
  let running = 0;
  let maxRunning = 0;
  const elk: ElkLike & { terminated: number } = {
    terminated: 0,
    layout(g) {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      return new Promise<ElkNode>((resolve) =>
        open.push({
          id: g.id,
          done: (r) => {
            running -= 1;
            resolve(r);
          },
        }),
      );
    },
    terminateWorker() {
      elk.terminated += 1;
    },
  };
  return { elk, open, maxRuns: () => maxRunning };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createWorkerLayoutEngine', () => {
  it('runs one layout at a time and keeps only the latest queued one', async () => {
    const c = controlled();
    const engine = createWorkerLayoutEngine({ startWorker: async () => c.elk });
    const a = engine.layout(graph('a'));
    await tick();
    const b = engine.layout(graph('b'));
    const cc = engine.layout(graph('c'));
    await expect(b).rejects.toBeInstanceOf(LayoutSupersededError);
    expect(c.open.map((o) => o.id)).toEqual(['a']);
    c.open[0]!.done(graph('a'));
    await expect(a).resolves.toEqual(graph('a'));
    await tick();
    expect(c.open.map((o) => o.id)).toEqual(['a', 'c']);
    c.open[1]!.done(graph('c'));
    await expect(cc).resolves.toEqual(graph('c'));
    expect(c.maxRuns()).toBe(1);
  });

  it('times out without falling back, terminates the worker, and starts a fresh one', async () => {
    const first = controlled();
    const second = controlled();
    const start = vi
      .fn<() => Promise<ElkLike>>()
      .mockResolvedValueOnce(first.elk)
      .mockResolvedValueOnce(second.elk);
    const main = vi.fn();
    const engine = createWorkerLayoutEngine({
      timeoutMs: 20,
      startWorker: start,
      startMainThread: main,
    });
    await expect(engine.layout(graph('a'))).rejects.toBeInstanceOf(LayoutTimeoutError);
    expect(first.elk.terminated).toBe(1);
    expect(main).not.toHaveBeenCalled();
    const b = engine.layout(graph('b'));
    await tick();
    expect(start).toHaveBeenCalledTimes(2);
    second.open[0]!.done(graph('b'));
    await expect(b).resolves.toEqual(graph('b'));
  });

  it('does not terminate the worker for a layout that is only queued', async () => {
    const c = controlled();
    const engine = createWorkerLayoutEngine({ timeoutMs: 20, startWorker: async () => c.elk });
    const a = engine.layout(graph('a'));
    const aResult = a.catch((e: unknown) => e);
    await tick();
    const b = engine.layout(graph('b'));
    const bResult = b.catch((e: unknown) => e);
    expect(await aResult).toBeInstanceOf(LayoutTimeoutError);
    // b only starts after a is over, on a fresh timer (and a fresh worker, so none is shared).
    await tick();
    expect(c.open.map((o) => o.id)).toContain('b');
    c.open.find((o) => o.id === 'b')!.done(graph('b'));
    expect(await bResult).toEqual(graph('b'));
  });

  it('falls back to the main thread only when the worker errors', async () => {
    let fail: (e: Error) => void = () => {};
    const stuck = controlled();
    const main = controlled();
    const engine = createWorkerLayoutEngine({
      startWorker: async (onError) => {
        fail = onError;
        return stuck.elk;
      },
      startMainThread: async () => main.elk,
    });
    const a = engine.layout(graph('a'));
    await tick();
    fail(new Error('boom'));
    await tick();
    expect(main.open.map((o) => o.id)).toEqual(['a']);
    main.open[0]!.done(graph('a'));
    await expect(a).resolves.toEqual(graph('a'));
    // Later layouts go straight to the main thread.
    const b = engine.layout(graph('b'));
    await tick();
    expect(main.open.map((o) => o.id)).toEqual(['a', 'b']);
    main.open[1]!.done(graph('b'));
    await b;
  });

  it('uses the main thread when the worker cannot be created', async () => {
    const main = controlled();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createWorkerLayoutEngine({
      startWorker: async () => {
        throw new Error('blocked');
      },
      startMainThread: async () => main.elk,
    });
    const a = engine.layout(graph('a'));
    await tick();
    main.open[0]!.done(graph('a'));
    await expect(a).resolves.toEqual(graph('a'));
    warn.mockRestore();
  });

  it('dispose() terminates the worker', async () => {
    const c = controlled();
    const engine = createWorkerLayoutEngine({ startWorker: async () => c.elk });
    const a = engine.layout(graph('a'));
    await tick();
    c.open[0]!.done(graph('a'));
    await a;
    engine.dispose();
    await tick();
    expect(c.elk.terminated).toBe(1);
  });
});
