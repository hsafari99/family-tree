import {
  addRelativeSchema,
  unionDatesError,
  updateParentChildSchema,
  updateUnionSchema,
} from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { parentChild, unions } from '../db/schema.js';
import { idParam, invalid, notFound, parseBody } from '../errors.js';
import { authorize, loadAccess } from '../trees/access.js';
import { audit, changedFields } from '../trees/audit.js';
import { loadLiveGraph, lockTreeGraph } from '../trees/graph.js';
import { requireLiveLink, requireLiveUnion, UNION_EDIT_FIELDS } from '../trees/relation-rows.js';
import { attachRelative, relativeEnds } from '../trees/relatives.js';
import type { TreeRouteOptions } from './trees.js';

export const relationsRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.post('/api/v1/trees/:treeId/persons/:personId/relatives', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    await loadAccess(db, treeId, req.user!.id); // outsiders: 404 before anything else
    const subjectId = idParam(req.params, 'personId');
    const input = parseBody(addRelativeSchema, req.body);
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, treeId);
      const live = (id: string) => graph.persons.some((p) => p.id === id);
      if (!live(subjectId)) throw notFound();
      if (!live(input.personId)) throw invalid('personId', 'Choose a person in this tree');
      if (input.personId === subjectId) throw invalid('personId', 'Choose someone else');
      const ends = [...relativeEnds(graph, subjectId, input), input.personId];
      authorize(access, 'relation.add', { kind: 'relation', ends });
      await attachRelative(tx, access, graph, subjectId, input.personId, input);
    });
    return reply.code(204).send();
  });

  app.patch('/api/v1/trees/:treeId/unions/:unionId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const u = await requireLiveUnion(db, access.treeId, idParam(req.params, 'unionId'));
    authorize(access, 'relation.edit', { kind: 'relation', ends: u.partners });
    const input = parseBody(updateUnionSchema, req.body);
    // Drop absent keys first: spreading `undefined` over the row would read as "cleared".
    const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const merged = { ...u, ...given };
    const datesError = unionDatesError(merged);
    if (datesError) throw invalid('endDate', datesError);
    const changes = changedFields(u, merged, UNION_EDIT_FIELDS);
    if (!changes) return reply.code(204).send();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(unions)
        .set(changes.after)
        .where(and(eq(unions.treeId, access.treeId), eq(unions.id, u.id), isNull(unions.deletedAt)))
        .returning({ id: unions.id });
      if (!row) throw notFound(); // deleted meanwhile: no write, no audit
      await audit(tx, access, {
        action: 'union.update',
        entityType: 'union',
        entityId: u.id,
        personIds: u.partners,
        ...changes,
      });
    });
    return reply.code(204).send();
  });

  app.patch('/api/v1/trees/:treeId/parent-child/:linkId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const l = await requireLiveLink(db, access.treeId, idParam(req.params, 'linkId'));
    const ends = [l.childId, ...l.partners];
    authorize(access, 'relation.edit', { kind: 'relation', ends });
    const { kind } = parseBody(updateParentChildSchema, req.body);
    if (kind === l.kind) return reply.code(204).send();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(parentChild)
        .set({ kind })
        .where(
          and(
            eq(parentChild.treeId, access.treeId),
            eq(parentChild.id, l.id),
            isNull(parentChild.deletedAt),
          ),
        )
        .returning({ id: parentChild.id });
      if (!row) throw notFound();
      await audit(tx, access, {
        action: 'link.update',
        entityType: 'link',
        entityId: l.id,
        personIds: ends,
        before: { kind: l.kind },
        after: { kind },
      });
    });
    return reply.code(204).send();
  });
};
