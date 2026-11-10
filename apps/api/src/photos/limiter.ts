export class LimiterFull extends Error {
  override name = 'LimiterFull';
}

/**
 * Runs at most `n` jobs at once; up to `maxWaiting` more wait in order, and beyond that the call
 * rejects at once with LimiterFull (decision 3), so a burst can't pile up buffered uploads.
 */
export function limiter(n: number, maxWaiting = Number.POSITIVE_INFINITY) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= n) {
      if (waiting.length >= maxWaiting) throw new LimiterFull('too many jobs waiting');
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await job();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
