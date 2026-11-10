import {
  createPersonSchema,
  PERSON_FIELDS,
  personConsistencyErrors,
  updatePersonSchema,
} from '@family-tree/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { persons } from '../db/schema.js';
import { AppError, conflict, idParam, notFound, parseBody } from '../errors.js';
import { TREE } from '../permissions/can.js';
import { authorize, loadAccess } from '../trees/access.js';
import { audit, changedFields } from '../trees/audit.js';
import { loadLiveGraph, lockTreeGraph } from '../trees/graph.js';
import { personColumns, personFieldsOf, requireLivePerson } from '../trees/people.js';
import { loadPersonView } from '../trees/person-view.js';
import { attachRelative, relativeEnds } from '../trees/relatives.js';
import type { TreeRouteOptions } from './trees.js';

export const personsRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.get('/api/v1/trees/:treeId/persons/:personId', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    return loadPersonView(db, access, idParam(req.params, 'personId'));
  });

  app.post('/api/v1/trees/:treeId/persons', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    // Outsiders get their 404 before the body is looked at.
    await loadAccess(db, treeId, req.user!.id);
    const { person, attach } = parseBody(createPersonSchema, req.body);
    const id = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      // Re-read inside the lock: the steward scope must match the graph we're about to change.
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, access.treeId);
      const ends = attach ? relativeEnds(graph, attach.to, attach) : [];
      authorize(access, 'person.add', { kind: 'relation', ends });
      const [row] = await tx
        .insert(persons)
        .values({
          treeId: access.treeId,
          ...personColumns(person),
          givenName: person.givenName,
          createdBy: access.userId,
          updatedBy: access.userId,
        })
        .returning();
      await audit(tx, access, {
        action: 'person.create',
        entityType: 'person',
        entityId: row!.id,
        personIds: [row!.id],
        after: personFieldsOf(row!),
      });
      if (attach) await attachRelative(tx, access, graph, attach.to, row!.id, attach);
      return row!.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch('/api/v1/trees/:treeId/persons/:personId', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const current = await requireLivePerson(db, access.treeId, idParam(req.params, 'personId'));
    authorize(access, 'person.edit', { kind: 'person', personId: current.id });
    const { version, ...input } = parseBody(updatePersonSchema, req.body);
    if (version !== current.version) throw staleEdit();
    const before = personFieldsOf(current);
    const merged = {
      ...before,
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    };
    const errors = personConsistencyErrors(merged);
    if (Object.keys(errors).length > 0) {
      throw new AppError('VALIDATION', 400, 'Some fields are invalid', errors);
    }
    const changes = changedFields(before, merged, PERSON_FIELDS);
    if (!changes) return { version: current.version };
    const next = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(persons)
        .set({
          ...personColumns(changes.after),
          updatedBy: access.userId,
          version: sql`${persons.version} + 1`,
        })
        .where(
          and(
            eq(persons.treeId, access.treeId),
            eq(persons.id, current.id),
            eq(persons.version, version),
            isNull(persons.deletedAt),
          ),
        )
        .returning({ version: persons.version });
      if (!row) {
        // Changed or deleted since we read it.
        const [still] = await tx
          .select({ id: persons.id })
          .from(persons)
          .where(
            and(
              eq(persons.treeId, access.treeId),
              eq(persons.id, current.id),
              isNull(persons.deletedAt),
            ),
          );
        throw still ? staleEdit() : notFound();
      }
      await audit(tx, access, {
        action: 'person.update',
        entityType: 'person',
        entityId: current.id,
        personIds: [current.id],
        ...changes,
      });
      return row.version;
    });
    return { version: next };
  });
};

const staleEdit = () => conflict('This person was changed by someone else; reload and try again');
