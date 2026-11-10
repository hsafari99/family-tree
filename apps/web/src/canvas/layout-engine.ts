import type { ELK, ElkNode } from 'elkjs/lib/elk-api.js';

export interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
}
export const LAYOUT_TIMEOUT_MS = 15_000;

/** The layout took longer than LAYOUT_TIMEOUT_MS; the page shows MESSAGES.layoutTooSlow. */
export class LayoutTimeoutError extends Error {
  override name = 'LayoutTimeoutError';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LayoutTimeoutError('layout timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const inThread = async (): Promise<ELK> => {
  const mod = await import('elkjs/lib/elk.bundled.js');
  const Elk = (mod.default ?? mod) as typeof mod.default; // CommonJS interop
  return new Elk();
};

/** The worker itself failed (blocked by CSP, missing file, script error). */
export class LayoutWorkerError extends Error {
  override name = 'LayoutWorkerError';
}

/**
 * ELK in a Web Worker (decision 4), loaded on first use so the 1.6 MB worker stays out of the
 * main bundle.
 * - It falls back to ELK on the main thread **only when the worker errors**: it couldn't be
 *   created, or `worker.onerror` fired.
 * - A timeout never falls back (a big graph would then freeze the page). It rejects with
 *   LayoutTimeoutError and starts a fresh worker next time.
 */
export function createWorkerLayoutEngine(): LayoutEngine {
  let elk: Promise<ELK> | null = null;
  let workerFailed = false;
  let failPending: ((e: Error) => void) | null = null;
  const start = async (): Promise<ELK> => {
    if (workerFailed) return inThread();
    try {
      const [api, { default: workerUrl }] = await Promise.all([
        import('elkjs/lib/elk-api.js'),
        import('elkjs/lib/elk-worker.min.js?url'),
      ]);
      const Elk = (api.default ?? api) as typeof api.default; // CommonJS interop
      return new Elk({
        workerUrl,
        // Our own factory, so a worker error is seen instead of leaving layout() pending forever.
        workerFactory: (url) => {
          const worker = new Worker(url ?? workerUrl);
          worker.onerror = (ev) => {
            ev.preventDefault();
            workerFailed = true;
            failPending?.(new LayoutWorkerError('ELK worker failed'));
          };
          return worker;
        },
      });
    } catch {
      workerFailed = true; // new Worker() threw (e.g. blocked)
      console.warn('ELK worker unavailable; laying out on the main thread');
      return inThread();
    }
  };
  return {
    async layout(graph) {
      elk ??= start();
      const engine = await elk;
      const workerError = new Promise<never>((_, reject) => {
        failPending = reject;
      });
      try {
        return await withTimeout(
          Promise.race([engine.layout(graph), workerError]),
          LAYOUT_TIMEOUT_MS,
        );
      } catch (err) {
        engine.terminateWorker();
        if (err instanceof LayoutWorkerError) {
          console.warn('ELK worker failed; laying out on the main thread');
          elk = inThread();
          return withTimeout((await elk).layout(graph), LAYOUT_TIMEOUT_MS);
        }
        elk = null; // timeout or ELK error: a fresh worker next time, never the main thread
        throw err;
      } finally {
        failPending = null;
      }
    },
  };
}

/** The one engine the app uses (one worker, shared by every canvas). */
export const browserLayoutEngine: LayoutEngine = createWorkerLayoutEngine();
