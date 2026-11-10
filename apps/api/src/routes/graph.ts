import { graphQuerySchema } from '@family-tree/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { idParam, parseBody } from '../errors.js';
import { TREE } from '../permissions/can.js';
import { authorize, loadAccess } from '../trees/access.js';
import { loadGraphRows } from '../trees/graph-rows.js';
import { buildTreeGraph } from '../trees/graph-view.js';
import type { TreeRouteOptions } from './trees.js';

export const graphRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  /** Everything the canvas needs in one response (spec §7). */
  app.get('/api/v1/trees/:treeId/graph', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const query = parseBody(graphQuerySchema, req.query);
    return buildTreeGraph(await loadGraphRows(db, access.treeId), access, query);
  });
};
