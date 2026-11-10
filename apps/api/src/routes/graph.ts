import {
  childOrderSchema,
  compareSiblings,
  connectedTo,
  findSimilar,
  graphQuerySchema,
  kinIndex,
  partnersOf,
  type PersonSummary,
  SIMILAR_LIMIT,
  similarQuerySchema,
} from '@family-tree/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { persons } from '../db/schema.js';
import { conflict, idParam, notFound, parseBody } from '../errors.js';
import { extraLimit } from '../security/limits.js';
import { TREE } from '../permissions/can.js';
import { authorize, loadAccess } from '../trees/access.js';
import { audit } from '../trees/audit.js';
import { loadLiveGraph, lockTreeGraph } from '../trees/graph.js';
import { loadGraphRows } from '../trees/graph-rows.js';
import { buildTreeGraph } from '../trees/graph-view.js';
import { summaryColumns } from '../trees/people.js';
import type { TreeRouteOptions } from './trees.js';

const toSummary = ({
  id,
  givenName,
  middleName,
  surname,
  birthYear,
  deathYear,
  isLiving,
}: PersonSummary): PersonSummary => ({
  id,
  givenName,
  middleName,
  surname,
  birthYear,
  deathYear,
  isLiving,
});
const byName = (a: PersonSummary, b: PersonSummary) =>
  (a.surname ?? '').localeCompare(b.surname ?? '') || a.givenName.localeCompare(b.givenName);

export const graphRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  /** Everything the canvas needs in one response (spec §7). */
  app.get('/api/v1/trees/:treeId/graph', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const query = parseBody(graphQuerySchema, req.query);
    return buildTreeGraph(await loadGraphRows(db, access.treeId), access, query);
  });

  /** Live people not reachable from the root through any relation (decision 7). */
  app.get('/api/v1/trees/:treeId/disconnected', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const rows = await loadGraphRows(db, access.treeId);
    const reached = connectedTo(kinIndex(rows), access.rootPersonId);
    return {
      persons: rows.persons
        .filter((p) => !reached.has(p.id))
        .map(toSummary)
        .sort(byName),
    };
  });

  /** The duplicate check (decision 8). */
  app.get(
    '/api/v1/trees/:treeId/persons/similar',
    {
      preHandler: extraLimit(app, { name: 'similar', max: 60, timeWindow: '1 minute', by: 'user' }),
    },
    async (req) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      authorize(access, 'tree.view', TREE);
      const q = parseBody(similarQuerySchema, req.query);
      const candidates = await db
        .select({ ...summaryColumns, maidenName: persons.maidenName, nickname: persons.nickname })
        .from(persons)
        .where(and(eq(persons.treeId, access.treeId), isNull(persons.deletedAt)));
      return { persons: findSimilar(candidates, q, SIMILAR_LIMIT).map(toSummary) };
    },
  );

  /** Sets sibling_order for every live child of a union (decision 16). */
  app.post('/api/v1/trees/:treeId/unions/:unionId/child-order', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    await loadAccess(db, treeId, req.user!.id); // outsiders: 404 before anything else
    const unionId = idParam(req.params, 'unionId');
    const { childIds } = parseBody(childOrderSchema, req.body);
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const graph = await loadLiveGraph(tx, treeId);
      const union = graph.unions.find((u) => u.id === unionId);
      if (!union) throw notFound();
      const current = graph.parentChild.filter((l) => l.unionId === unionId).map((l) => l.childId);
      const partners = partnersOf(union);
      authorize(access, 'relation.edit', { kind: 'relation', ends: [...partners, ...current] });
      // It writes every child's person row, so a steward needs each child in scope (decision 16).
      // person.edit is editsAnywhere || inScope: owners and editors pass unrestricted.
      for (const childId of current) {
        authorize(access, 'person.edit', { kind: 'person', personId: childId });
      }
      const same =
        current.length === childIds.length && childIds.every((id) => current.includes(id));
      if (!same) throw conflict('The children of this relationship changed; reload and try again');
      const before = (
        await tx
          .select({
            id: persons.id,
            givenName: persons.givenName,
            siblingOrder: persons.siblingOrder,
            birthYear: persons.birthSortYear,
          })
          .from(persons)
          .where(and(eq(persons.treeId, treeId), inArray(persons.id, current)))
      )
        .sort(compareSiblings)
        .map((p) => p.id);
      // Not a person-field edit: no version bump, so nobody's open edit form goes stale.
      await tx.execute(sql`
        update persons set sibling_order = o.ord
        from unnest(array[${sql.join(
          childIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]) with ordinality as o(id, ord)
        where persons.id = o.id and persons.tree_id = ${treeId}`);
      await audit(tx, access, {
        action: 'link.reorder',
        entityType: 'union',
        entityId: unionId,
        personIds: [...partners, ...childIds],
        before: { childIds: before },
        after: { childIds },
      });
    });
    return reply.code(204).send();
  });
};
