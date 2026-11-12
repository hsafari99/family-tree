import {
  addRelativeSchema,
  ancestorsOf,
  descendantsOf,
  partnersOf,
  reparentLinkSchema,
  unionDatesError,
  updateParentChildSchema,
  unionOrderSchema,
  updateUnionSchema,
  wouldCycle,
} from '@family-tree/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { deletionBatches, parentChild, unions } from '../db/schema.js';
import { conflict, idParam, invalid, notFound, parseBody } from '../errors.js';
import { authorize, loadAccess } from '../trees/access.js';
import { audit, changedFields } from '../trees/audit.js';
import { loadLiveGraph, lockTreeGraph } from '../trees/graph.js';
import { byOwnOrder } from '../trees/person-view.js';
import {
  requireLiveLink,
  requireLiveUnion,
  UNION_EDIT_FIELDS,
  unionFieldsOf,
} from '../trees/relation-rows.js';
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
      const ends = [...relativeEnds(graph, subjectId, input, input.personId), input.personId];
      authorize(access, 'relation.add', { kind: 'relation', ends });
      await attachRelative(tx, access, graph, subjectId, input.personId, input);
    });
    return reply.code(204).send();
  });

  app.patch('/api/v1/trees/:treeId/unions/:unionId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const u = await requireLiveUnion(db, access.treeId, idParam(req.params, 'unionId'));
    if (u.parentsUnknown && u.partners.length === 0) {
      throw invalid('type', 'Unknown parents have no relationship details to edit');
    }
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

  // Re-parent: move a child's link to another union in place (brief #13, decision 3). The link
  // id and kind stay; nothing goes to Trash.
  app.post('/api/v1/trees/:treeId/parent-child/:linkId/reparent', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    await loadAccess(db, treeId, req.user!.id); // outsiders: 404 before anything else
    const linkId = idParam(req.params, 'linkId');
    const { unionId } = parseBody(reparentLinkSchema, req.body);
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, treeId);
      const link = graph.parentChild.find((l) => l.id === linkId);
      if (!link) throw notFound();
      const from = graph.unions.find((u) => u.id === link.unionId)!;
      const to = graph.unions.find((u) => u.id === unionId);
      if (!to) throw invalid('unionId', 'Choose parents in this tree');
      if (to.id === from.id) return;
      authorize(access, 'link.reparent', {
        kind: 'reparent',
        childId: link.childId,
        fromParents: partnersOf(from),
        toParents: partnersOf(to),
      });
      if (graph.parentChild.some((l) => l.unionId === to.id && l.childId === link.childId)) {
        throw conflict('They are already a child of those parents');
      }
      if (partnersOf(to).includes(link.childId)) {
        throw invalid('unionId', 'A parent can’t also be the child');
      }
      const without = { ...graph, parentChild: graph.parentChild.filter((l) => l.id !== link.id) };
      if (wouldCycle(without, partnersOf(to), [link.childId])) {
        throw invalid('unionId', 'That would make someone their own ancestor');
      }
      if (partnersOf(to).length === 0) {
        // Onto a parents-unknown union: its children become siblings, so none may be lineal kin.
        const kids = without.parentChild.filter((l) => l.unionId === to.id).map((l) => l.childId);
        const lineal = (c: string) =>
          ancestorsOf(without, c).has(link.childId) || descendantsOf(without, c).has(link.childId);
        if (kids.some(lineal))
          throw invalid('unionId', 'A parent or child can’t also be a sibling');
      }
      const [fromRow] = await tx.select().from(unions).where(eq(unions.id, from.id));
      const [row] = await tx
        .update(parentChild)
        .set({ unionId: to.id })
        .where(
          and(
            eq(parentChild.treeId, treeId),
            eq(parentChild.id, link.id),
            eq(parentChild.unionId, from.id),
            isNull(parentChild.deletedAt),
          ),
        )
        .returning({ id: parentChild.id });
      if (!row) throw conflict('Those parents changed; reload and try again');
      await audit(tx, access, {
        action: 'link.reparent',
        entityType: 'link',
        entityId: link.id,
        personIds: [...new Set([link.childId, ...partnersOf(from), ...partnersOf(to)])],
        before: { unionId: from.id },
        after: { unionId: to.id },
      });
      // A parents-unknown union is never left childless (decision 1).
      const leftLive = without.parentChild.some((l) => l.unionId === from.id);
      if (from.parentsUnknown && partnersOf(from).length === 0 && !leftLive) {
        const trashed = await tx
          .select({ batch: parentChild.deletionBatchId })
          .from(parentChild)
          .innerJoin(deletionBatches, eq(deletionBatches.id, parentChild.deletionBatchId))
          .where(and(eq(parentChild.unionId, from.id), isNull(deletionBatches.restoredAt)))
          .orderBy(desc(deletionBatches.createdAt))
          .limit(1);
        if (trashed[0]?.batch) {
          // A trashed sibling still points at it: it goes with the newest such batch, so a
          // restore brings the siblings back together.
          await tx
            .update(unions)
            .set({ deletedAt: sql`now()`, deletionBatchId: trashed[0].batch })
            .where(eq(unions.id, from.id));
        } else {
          // Nothing refers to it and it holds nothing (no partners, children or details).
          await tx.delete(unions).where(and(eq(unions.treeId, treeId), eq(unions.id, from.id)));
        }
        await audit(tx, access, {
          action: 'union.delete',
          entityType: 'union',
          entityId: from.id,
          personIds: [link.childId],
          before: unionFieldsOf(fromRow!),
        });
      }
    });
    return reply.code(204).send();
  });

  // Swap a couple's sides on the tree (brief #16). Each person's own union order goes with them.
  app.post('/api/v1/trees/:treeId/unions/:unionId/swap-partners', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    await loadAccess(db, treeId, req.user!.id); // outsiders: 404 before anything else
    const unionId = idParam(req.params, 'unionId');
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, treeId);
      const u = graph.unions.find((x) => x.id === unionId);
      if (!u) throw notFound();
      if (u.partnerAId === null || u.partnerBId === null) {
        throw invalid('unionId', 'Only a couple has two sides');
      }
      const [a, b] = [u.partnerAId, u.partnerBId];
      authorize(access, 'relation.edit', { kind: 'relation', ends: [a, b] });
      const [row] = await tx
        .update(unions)
        .set({
          partnerAId: b,
          partnerBId: a,
          partnerAOrder: sql`${unions.partnerBOrder}`,
          partnerBOrder: sql`${unions.partnerAOrder}`,
        })
        .where(
          and(
            eq(unions.treeId, treeId),
            eq(unions.id, u.id),
            eq(unions.partnerAId, a),
            eq(unions.partnerBId, b),
            isNull(unions.deletedAt),
          ),
        )
        .returning({ id: unions.id });
      if (!row) throw conflict('That relationship changed; reload and try again');
      await audit(tx, access, {
        action: 'union.swapPartners',
        entityType: 'union',
        entityId: u.id,
        personIds: [a, b],
        before: { partnerAId: a, partnerBId: b },
        after: { partnerAId: b, partnerBId: a },
      });
    });
    return reply.code(204).send();
  });

  // Order someone's partners (brief #16). Only this person's own slot order changes.
  app.post('/api/v1/trees/:treeId/persons/:personId/union-order', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    await loadAccess(db, treeId, req.user!.id); // outsiders: 404 before anything else
    const personId = idParam(req.params, 'personId');
    const { unionIds } = parseBody(unionOrderSchema, req.body);
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, treeId);
      if (!graph.persons.some((p) => p.id === personId)) throw notFound();
      const mine = graph.unions.filter((u) => partnersOf(u).includes(personId));
      // A subset is fine (the canvas knows only the couples on screen), but every id must be theirs.
      if (!unionIds.every((id) => mine.some((u) => u.id === id))) {
        throw conflict('Their relationships changed; reload and try again');
      }
      const ends = [...new Set(mine.flatMap(partnersOf))];
      authorize(access, 'relation.edit', { kind: 'relation', ends });
      // Their current order, exactly as the person view shows it.
      const rows = await tx
        .select({
          id: unions.id,
          partnerAId: unions.partnerAId,
          partnerAOrder: unions.partnerAOrder,
          partnerBOrder: unions.partnerBOrder,
          startDate: unions.startDate,
          createdAt: unions.createdAt,
        })
        .from(unions)
        .where(
          and(
            eq(unions.treeId, treeId),
            inArray(
              unions.id,
              mine.map((u) => u.id),
            ),
          ),
        );
      const before = rows.sort(byOwnOrder(personId)).map((x) => x.id);
      // The listed unions trade places among the positions they already hold; the rest stay put.
      const picked = new Set(unionIds);
      let k = 0;
      const after = before.map((id) => (picked.has(id) ? unionIds[k++]! : id));
      // 1..n for all of this person's unions, so an unsaved one (ordered by start date) can't later
      // jump ahead of or behind a saved order. Their partners' own orders stay as they are.
      await tx.execute(sql`
        update unions set
          partner_a_order = case when unions.partner_a_id = ${personId}::uuid then o.ord else unions.partner_a_order end,
          partner_b_order = case when unions.partner_b_id = ${personId}::uuid then o.ord else unions.partner_b_order end
        from unnest(array[${sql.join(
          after.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]) with ordinality as o(id, ord)
        where unions.id = o.id and unions.tree_id = ${treeId}::uuid`);
      await audit(tx, access, {
        action: 'union.reorder',
        entityType: 'person',
        entityId: personId,
        personIds: ends,
        before: { unionIds: before },
        after: { unionIds: after },
      });
    });
    return reply.code(204).send();
  });
};
