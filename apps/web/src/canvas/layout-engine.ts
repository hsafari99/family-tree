import type { ElkNode } from 'elkjs/lib/elk-api.js';

export interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
  /** Releases the worker (the page is going away). Optional: fakes have nothing to release. */
  dispose?(): void;
}
export const LAYOUT_TIMEOUT_MS = 15_000;

/** The layout took longer than LAYOUT_TIMEOUT_MS; the page shows MESSAGES.layoutTooSlow. */
export class LayoutTimeoutError extends Error {
  override name = 'LayoutTimeoutError';
}

/** The worker itself failed (blocked by CSP, missing file, script error). */
export class LayoutWorkerError extends Error {
  override name = 'LayoutWorkerError';
}

/** A newer layout was requested while this one was still queued, so it was dropped. */
export class LayoutSupersededError extends Error {
  override name = 'LayoutSupersededError';
}

/** The part of ELK the engine uses. */
export interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>;
  terminateWorker(): void;
}

export interface WorkerEngineOptions {
  timeoutMs?: number;
  /** Starts ELK in a worker. `onError` must be called if the worker fails; rejects if it can't start. */
  startWorker?: (onError: (e: Error) => void) => Promise<ElkLike>;
  startMainThread?: () => Promise<ElkLike>;
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

const mainThreadElk = async (): Promise<ElkLike> => {
  const mod = await import('elkjs/lib/elk.bundled.js');
  const Elk = (mod.default ?? mod) as typeof mod.default; // CommonJS interop
  return new Elk();
};

const workerElk = async (onError: (e: Error) => void): Promise<ElkLike> => {
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
        onError(new LayoutWorkerError('ELK worker failed'));
      };
      return worker;
    },
  });
};

interface Job {
  graph: ElkNode;
  resolve: (g: ElkNode) => void;
  reject: (e: unknown) => void;
}

/**
 * ELK in a Web Worker (decision 4), loaded on first use so the 1.6 MB worker stays out of the
 * main bundle. One shared engine and worker for the whole app (decision 21).
 * - **One layout at a time.** A request that arrives while another is queued replaces it (the
 *   older one rejects with LayoutSupersededError): only the latest view is worth drawing. So a
 *   timeout or a worker restart never affects a call that is waiting on the same worker.
 * - It falls back to ELK on the main thread **only when the worker errors**: it couldn't be
 *   created, or `worker.onerror` fired.
 * - A timeout never falls back (a big graph would then freeze the page). It rejects with
 *   LayoutTimeoutError and the next layout starts a fresh worker.
 */
export function createWorkerLayoutEngine(
  options: WorkerEngineOptions = {},
): LayoutEngine & { dispose(): void } {
  const timeoutMs = options.timeoutMs ?? LAYOUT_TIMEOUT_MS;
  const startWorker = options.startWorker ?? workerElk;
  const startMain = options.startMainThread ?? mainThreadElk;
  let elk: Promise<ElkLike> | null = null;
  let workerFailed = false;
  // Rejects the layout that is running right now (there is at most one).
  let failRunning: ((e: Error) => void) | null = null;

  const onWorkerError = (e: Error) => {
    workerFailed = true;
    if (failRunning)
      failRunning(e instanceof LayoutWorkerError ? e : new LayoutWorkerError(e.message));
    else elk = null;
  };
  const start = async (): Promise<ElkLike> => {
    if (workerFailed) return startMain();
    try {
      return await startWorker(onWorkerError);
    } catch {
      workerFailed = true; // new Worker() threw (e.g. blocked)
      console.warn('ELK worker unavailable; laying out on the main thread');
      return startMain();
    }
  };

  async function runOne(graph: ElkNode): Promise<ElkNode> {
    elk ??= start();
    const engine = await elk;
    const workerError = new Promise<never>((_, reject) => {
      failRunning = reject;
    });
    try {
      return await withTimeout(Promise.race([engine.layout(graph), workerError]), timeoutMs);
    } catch (err) {
      engine.terminateWorker();
      if (err instanceof LayoutWorkerError) {
        console.warn('ELK worker failed; laying out on the main thread');
        elk = startMain();
        return withTimeout((await elk).layout(graph), timeoutMs);
      }
      elk = null; // timeout or ELK error: a fresh worker next time, never the main thread
      throw err;
    } finally {
      failRunning = null;
    }
  }

  let running = false;
  let queued: Job | null = null;
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queued) {
        const job: Job = queued;
        queued = null;
        try {
          job.resolve(await runOne(job.graph));
        } catch (err) {
          job.reject(err);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    layout(graph) {
      return new Promise<ElkNode>((resolve, reject) => {
        queued?.reject(new LayoutSupersededError('a newer layout was requested'));
        queued = { graph, resolve, reject };
        void pump();
      });
    },
    dispose() {
      const current = elk;
      elk = null;
      void current?.then((e) => e.terminateWorker()).catch(() => {});
    },
  };
}

/** The one engine the app uses (one worker, shared by every canvas); released on page hide. */
export const browserLayoutEngine = createWorkerLayoutEngine();
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => browserLayoutEngine.dispose());
}
