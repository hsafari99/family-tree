import type { ElkNode } from 'elkjs/lib/elk-api.js';

/** Lays out an ELK graph. The browser uses ELK in a Web Worker; tests inject a fake. */
export interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
}
