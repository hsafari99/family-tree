import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { LayoutEngine } from '../canvas/layout-engine';

/** Places nodes on a grid in input order. `failNext()` makes the next layout reject. */
export class FakeLayoutEngine implements LayoutEngine {
  calls: ElkNode[] = [];
  private failing: Error | null = null;
  /** The next layout rejects with `error` (for example a LayoutTimeoutError). */
  failNext(error: Error = new Error('layout failed')) {
    this.failing = error;
  }
  async layout(graph: ElkNode): Promise<ElkNode> {
    this.calls.push(graph);
    if (this.failing) {
      const error = this.failing;
      this.failing = null;
      throw error;
    }
    return {
      ...graph,
      children: (graph.children ?? []).map((c, i) => ({
        ...c,
        x: (i % 8) * 220,
        y: Math.floor(i / 8) * 140,
      })),
    };
  }
}
