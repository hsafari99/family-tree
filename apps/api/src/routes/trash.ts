import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { idParam } from '../errors.js';
import { drainStorageDeletions } from '../storage/deletions.js';
import { TREE } from '../permissions/can.js';
import { authorize, loadAccess } from '../trees/access.js';
import { lockTreeGraph } from '../trees/graph.js';
import { eraseBatch, listTrash, restoreBatch, trashBatchDetail } from '../trees/trash.js';
import type { TreeRouteOptions } from './trees.js';

export const trashRoutes: FastifyPluginAsync<TreeRouteOptions> = async (
  app,
  { auth, db, storage },
) => {
  app.addHook('preHandler', requireSession(auth));
  const base = '/api/v1/trees/:treeId/trash';

  app.get(base, async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'trash.view', TREE);
    return { batches: await listTrash(db, access.treeId) };
  });

  app.get(`${base}/:batchId`, async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'trash.view', TREE);
    return trashBatchDetail(db, access.treeId, idParam(req.params, 'batchId'));
  });

  app.post(`${base}/:batchId/restore`, async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    const batchId = idParam(req.params, 'batchId');
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      authorize(access, 'trash.restore', TREE);
      await restoreBatch(tx, access, batchId);
    });
    return reply.code(204).send();
  });

  app.delete(`${base}/:batchId`, async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    const batchId = idParam(req.params, 'batchId');
    const keys = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      authorize(access, 'trash.erase', TREE);
      return eraseBatch(tx, access, batchId);
    });
    await drainStorageDeletions(db, storage, { keys, log: req.log });
    return reply.code(204).send();
  });
};
