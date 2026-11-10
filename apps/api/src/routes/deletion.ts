import {
  type DeleteMode,
  deletePersonSchema,
  type DeletePreview,
  type DeletionPlan,
  planLinkDeletion,
  planPersonDeletion,
  planUnionDeletion,
} from '@family-tree/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import type { Queryable, Tx } from '../db/client.js';
import { persons, trees } from '../db/schema.js';
import { idParam, invalid, notFound, parseBody } from '../errors.js';
import { can, inScope } from '../permissions/can.js';
import { type Access, authorize, loadAccess } from '../trees/access.js';
import { audit } from '../trees/audit.js';
import { applyPlan, createBatch } from '../trees/deletion.js';
import { loadLiveGraph, lockTreeGraph } from '../trees/graph.js';
import { fullName, requireLivePerson, summaryColumns } from '../trees/people.js';
import type { TreeRouteOptions } from './trees.js';

async function personPlan(db: Queryable, access: Access, personId: string, mode: DeleteMode) {
  const graph = await loadLiveGraph(db, access.treeId);
  if (!graph.persons.some((p) => p.id === personId)) throw notFound();
  authorize(access, 'person.delete', { kind: 'people', personIds: [personId] });
  return planPersonDeletion(graph, personId, mode);
}

async function commit(
  tx: Tx,
  access: Access,
  plan: DeletionPlan,
  batch: Parameters<typeof createBatch>[2],
  root?: { id: string; name: string },
) {
  const batchId = await createBatch(tx, access, batch);
  await applyPlan(tx, access.treeId, batchId, plan);
  await audit(tx, access, {
    action:
      batch.mode === 'relation'
        ? batch.rootUnionId
          ? 'union.delete'
          : 'link.delete'
        : 'person.delete',
    entityType: 'batch',
    entityId: batchId,
    personIds: plan.touchedPersonIds,
    after: {
      mode: batch.mode,
      ...(root ? { rootPersonId: root.id, rootName: root.name } : {}),
      people: plan.personIds.length,
      unions: plan.unionIds.length,
      links: plan.parentChildIds.length,
    },
  });
  return batchId;
}

export const deletionRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.post('/api/v1/trees/:treeId/persons/:personId/delete-preview', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const personId = idParam(req.params, 'personId');
    const { mode } = parseBody(deletePersonSchema, req.body);
    const plan = await personPlan(db, access, personId, mode);
    const people = await db
      .select(summaryColumns)
      .from(persons)
      .where(and(eq(persons.treeId, access.treeId), inArray(persons.id, plan.personIds)));
    const order = new Map(plan.personIds.map((id, i) => [id, i]));
    people.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const blockedByRoot =
      access.rootPersonId !== null && plan.personIds.includes(access.rootPersonId);
    const body: DeletePreview = {
      mode,
      people,
      unions: plan.unionIds.length + new Set(plan.slots.map((s) => s.unionId)).size,
      links: plan.parentChildIds.length,
      outsideScope:
        access.role === 'owner'
          ? 0
          : plan.touchedPersonIds.filter((id) => !inScope(access, id)).length,
      blockedByRoot,
      allowed:
        !blockedByRoot &&
        can(access, 'person.delete', { kind: 'people', personIds: plan.touchedPersonIds }),
    };
    return body;
  });

  app.post('/api/v1/trees/:treeId/persons/:personId/delete', async (req) => {
    const treeId = idParam(req.params, 'treeId');
    await loadAccess(db, treeId, req.user!.id); // outsiders: 404 before the body
    const personId = idParam(req.params, 'personId');
    const { mode } = parseBody(deletePersonSchema, req.body);
    const batchId = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      // The advisory lock above serialises us with a root change (PATCH /trees/:id); this locks
      // the trees row and reads the current root.
      const [tree] = await tx
        .select({ rootPersonId: trees.rootPersonId })
        .from(trees)
        .where(eq(trees.id, access.treeId))
        .for('update');
      const plan = await personPlan(tx, access, personId, mode);
      if (tree?.rootPersonId && plan.personIds.includes(tree.rootPersonId)) {
        throw invalid('personId', 'Choose a new starting person first');
      }
      authorize(access, 'person.delete', { kind: 'people', personIds: plan.touchedPersonIds });
      const rootRow = await requireLivePerson(tx, access.treeId, personId);
      return commit(
        tx,
        access,
        plan,
        { mode, rootPersonId: personId, slots: plan.slots },
        { id: personId, name: fullName(rootRow) },
      );
    });
    return { batchId };
  });

  app.post('/api/v1/trees/:treeId/unions/:unionId/delete', async (req) => {
    const treeId = idParam(req.params, 'treeId');
    const unionId = idParam(req.params, 'unionId');
    const batchId = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, access.treeId);
      if (!graph.unions.some((u) => u.id === unionId)) throw notFound();
      const plan = planUnionDeletion(graph, unionId);
      authorize(access, 'relation.delete', { kind: 'people', personIds: plan.touchedPersonIds });
      return commit(tx, access, plan, { mode: 'relation', rootUnionId: unionId, slots: [] });
    });
    return { batchId };
  });

  app.post('/api/v1/trees/:treeId/parent-child/:linkId/delete', async (req) => {
    const treeId = idParam(req.params, 'treeId');
    const linkId = idParam(req.params, 'linkId');
    const batchId = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, access.treeId);
      if (!graph.parentChild.some((l) => l.id === linkId)) throw notFound();
      const plan = planLinkDeletion(graph, linkId);
      authorize(access, 'relation.delete', { kind: 'people', personIds: plan.touchedPersonIds });
      return commit(tx, access, plan, { mode: 'relation', rootParentChildId: linkId, slots: [] });
    });
    return { batchId };
  });
};
