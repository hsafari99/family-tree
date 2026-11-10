import { describe, expect, it } from 'vitest';
import { LimiterFull, limiter } from './limiter.js';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('limiter', () => {
  it('runs at most n jobs at once, in order', async () => {
    const run = limiter(2);
    let running = 0;
    let peak = 0;
    const finished: number[] = [];
    const gates = Array.from({ length: 5 }, deferred);
    const jobs = gates.map((g, i) =>
      run(async () => {
        running++;
        peak = Math.max(peak, running);
        await g.promise;
        running--;
        finished.push(i);
      }),
    );
    await tick();
    expect(running).toBe(2);
    for (const g of gates) {
      g.resolve();
      await tick();
    }
    await Promise.all(jobs);
    expect(peak).toBe(2);
    expect(finished).toEqual([0, 1, 2, 3, 4]);
  });

  it('releases the slot when a job rejects', async () => {
    const run = limiter(1);
    await expect(run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(run(() => Promise.resolve(7))).resolves.toBe(7);
  });

  it('refuses at once beyond maxWaiting', async () => {
    const run = limiter(1, 2);
    const gate = deferred();
    const first = [run(() => gate.promise), run(() => gate.promise), run(() => gate.promise)];
    await tick();
    await expect(run(() => gate.promise)).rejects.toBeInstanceOf(LimiterFull);
    gate.resolve();
    await expect(Promise.all(first)).resolves.toHaveLength(3);
  });
});
