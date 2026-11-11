import {
  createPersonSchema,
  HISTORY_ACTION_PREFIXES,
  HISTORY_LIMIT,
  type HistoryEntry,
  PERSON_FIELDS,
  partnersOf,
  personConsistencyErrors,
  updatePersonSchema,
} from '@family-tree/shared';
import { and, arrayContains, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { auditLog, persons, users } from '../db/schema.js';
import { AppError, conflict, idParam, invalid, notFound, parseBody } from '../errors.js';
import { TREE } from '../permissions/can.js';
import { authorize, loadAccess } from '../trees/access.js';
import { audit, changedFields } from '../trees/audit.js';
import { loadLiveGraph, lockTreeGraph } from '../trees/graph.js';
import { personColumns, personFieldsOf, requireLivePerson } from '../trees/people.js';
import { loadPersonView } from '../trees/person-view.js';
import { attachRelative, relativeEnds, targetUnion } from '../trees/relatives.js';
import type { TreeRouteOptions } from './trees.js';

export const personsRoutes: FastifyPluginAsync<TreeRouteOptions> = async (
  app,
  { auth, db, config, storage },
) => {
  app.addHook('preHandler', requireSession(auth));

  app.get('/api/v1/trees/:treeId/persons/:personId', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    return loadPersonView(
      db,
      access,
      idParam(req.params, 'personId'),
      storage,
      config.MAX_PHOTO_BYTES_PER_TREE,
    );
  });

  app.post('/api/v1/trees/:treeId/persons', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    // Outsiders get their 404 before the body is looked at.
    await loadAccess(db, treeId, req.user!.id);
    const { person, attach, coParent } = parseBody(createPersonSchema, req.body);
    const id = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      // Re-read inside the lock: the steward scope must match the graph we're about to change.
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, access.treeId);
      const ends = attach ? relativeEnds(graph, attach.to, attach) : [];
      authorize(access, 'person.add', { kind: 'relation', ends });
      if (coParent && attach) {
        const target = targetUnion(graph, attach.to, attach);
        // A union with a parent already is "waiting for a partner"; an empty parents-unknown union
        // isn't: both new parents fill its slots, so the siblings share them (brief #9, #11).
        if (target !== null && partnersOf(target).length > 0) {
          throw invalid(
            'coParent',
            'They already have a parent waiting for a partner; add this parent to that pair',
          );
        }
      }
      const insertPerson = async (fields: typeof person) => {
        const [row] = await tx
          .insert(persons)
          .values({
            treeId: access.treeId,
            ...personColumns(fields),
            givenName: fields.givenName,
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
        return row!.id;
      };
      const newId = await insertPerson(person);
      if (attach) await attachRelative(tx, access, graph, attach.to, newId, attach);
      if (coParent && attach) {
        // The union the first parent just went into: they are its only partner, attach.to its child.
        const after = await loadLiveGraph(tx, access.treeId);
        const union = after.unions.find(
          (u) =>
            partnersOf(u).length === 1 &&
            partnersOf(u)[0] === newId &&
            after.parentChild.some((l) => l.unionId === u.id && l.childId === attach.to),
        )!;
        let secondId: string;
        if ('personId' in coParent) {
          if (!after.persons.some((p) => p.id === coParent.personId)) {
            throw invalid('coParent', 'Choose a person in this tree');
          }
          secondId = coParent.personId;
        } else {
          secondId = await insertPerson(coParent.person);
        }
        await attachRelative(tx, access, after, attach.to, secondId, {
          as: 'parent',
          unionId: union.id,
          kind: attach.kind,
        });
      }
      return newId;
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

  app.get('/api/v1/trees/:treeId/persons/:personId/history', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const person = await requireLivePerson(db, access.treeId, idParam(req.params, 'personId'));
    const rows = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityId: auditLog.entityId,
        before: auditLog.before,
        after: auditLog.after,
        createdAt: auditLog.createdAt,
        by: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(
        and(
          eq(auditLog.treeId, access.treeId),
          arrayContains(auditLog.personIds, [person.id]),
          // Decision 13: only changes to people and relations, never member/steward/invite rows.
          or(...HISTORY_ACTION_PREFIXES.map((prefix) => like(auditLog.action, `${prefix}%`))),
        ),
      )
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(HISTORY_LIMIT);
    const entries: HistoryEntry[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      at: r.createdAt.toISOString(),
      by: r.by,
      changes:
        r.action === 'person.update' && r.entityId === person.id
          ? Object.keys((r.after ?? {}) as object).map((field) => ({
              field,
              before: (r.before as Record<string, unknown> | null)?.[field] ?? null,
              after: (r.after as Record<string, unknown>)[field],
            }))
          : [],
    }));
    return { entries };
  });
};

const staleEdit = () => conflict('This person was changed by someone else; reload and try again');
