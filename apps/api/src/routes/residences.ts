import { residenceInputSchema, RESIDENCES_MAX } from '@family-tree/shared';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import type { Queryable } from '../db/client.js';
import { persons, residences } from '../db/schema.js';
import { idParam, invalid, notFound, parseBody } from '../errors.js';
import { authorize, loadAccess } from '../trees/access.js';
import { audit, changedFields } from '../trees/audit.js';
import { requireLivePerson } from '../trees/people.js';
import type { TreeRouteOptions } from './trees.js';

async function requireResidence(db: Queryable, treeId: string, residenceId: string) {
  const [r] = await db
    .select({ r: residences })
    .from(residences)
    .innerJoin(persons, and(eq(persons.id, residences.personId), isNull(persons.deletedAt)))
    .where(
      and(
        eq(residences.treeId, treeId),
        eq(residences.id, residenceId),
        isNull(residences.deletedAt),
      ),
    );
  if (!r) throw notFound();
  return r.r;
}

const residenceFields = (r: { place: string; fromDate: unknown; toDate: unknown }) => ({
  place: r.place,
  fromDate: r.fromDate,
  toDate: r.toDate,
});

export const residencesRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.post('/api/v1/trees/:treeId/persons/:personId/residences', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const person = await requireLivePerson(db, access.treeId, idParam(req.params, 'personId'));
    authorize(access, 'person.edit', { kind: 'person', personId: person.id });
    const input = parseBody(residenceInputSchema, req.body);
    const id = await db.transaction(async (tx) => {
      // A per-person lock, so two adds can't both slip under the cap.
      const [locked] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.id, person.id), isNull(persons.deletedAt)))
        .for('update');
      if (!locked) throw notFound();
      const [n] = await tx
        .select({ n: count() })
        .from(residences)
        .where(
          and(
            eq(residences.treeId, access.treeId),
            eq(residences.personId, person.id),
            isNull(residences.deletedAt),
          ),
        );
      if ((n?.n ?? 0) >= RESIDENCES_MAX) {
        throw invalid('place', `A person can have at most ${RESIDENCES_MAX} places of residence`);
      }
      const [row] = await tx
        .insert(residences)
        .values({ treeId: access.treeId, personId: person.id, ...input })
        .returning();
      await audit(tx, access, {
        action: 'residence.create',
        entityType: 'residence',
        entityId: row!.id,
        personIds: [person.id],
        after: residenceFields(row!),
      });
      return row!.id;
    });
    return reply.code(201).send({ id });
  });

  app.patch('/api/v1/trees/:treeId/residences/:residenceId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const r = await requireResidence(db, access.treeId, idParam(req.params, 'residenceId'));
    authorize(access, 'person.edit', { kind: 'person', personId: r.personId });
    const input = parseBody(residenceInputSchema, req.body);
    const changes = changedFields(residenceFields(r), input, ['place', 'fromDate', 'toDate']);
    if (!changes) return reply.code(204).send();
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(residences)
        .set({ place: input.place, fromDate: input.fromDate, toDate: input.toDate })
        .where(and(eq(residences.treeId, access.treeId), eq(residences.id, r.id)))
        .returning({ id: residences.id });
      if (!row) throw notFound();
      await audit(tx, access, {
        action: 'residence.update',
        entityType: 'residence',
        entityId: r.id,
        personIds: [r.personId],
        ...changes,
      });
    });
    return reply.code(204).send();
  });

  app.delete('/api/v1/trees/:treeId/residences/:residenceId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const r = await requireResidence(db, access.treeId, idParam(req.params, 'residenceId'));
    authorize(access, 'person.edit', { kind: 'person', personId: r.personId });
    await db.transaction(async (tx) => {
      const gone = await tx
        .delete(residences)
        .where(and(eq(residences.treeId, access.treeId), eq(residences.id, r.id)))
        .returning({ id: residences.id });
      if (gone.length === 0) throw notFound();
      await audit(tx, access, {
        action: 'residence.delete',
        entityType: 'residence',
        entityId: r.id,
        personIds: [r.personId],
        before: residenceFields(r),
      });
    });
    return reply.code(204).send();
  });
};
