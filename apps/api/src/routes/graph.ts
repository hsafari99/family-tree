import {
  connectedTo,
  findSimilar,
  graphQuerySchema,
  kinIndex,
  type PersonSummary,
  SIMILAR_LIMIT,
  similarQuerySchema,
} from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { persons } from '../db/schema.js';
import { idParam, parseBody } from '../errors.js';
import { TREE } from '../permissions/can.js';
import { authorize, loadAccess } from '../trees/access.js';
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
    return { persons: rows.persons.filter((p) => !reached.has(p.id)).map(toSummary).sort(byName) };
  });

  /** The duplicate check (decision 8). */
  app.get('/api/v1/trees/:treeId/persons/similar', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const q = parseBody(similarQuerySchema, req.query);
    const candidates = await db
      .select({ ...summaryColumns, maidenName: persons.maidenName, nickname: persons.nickname })
      .from(persons)
      .where(and(eq(persons.treeId, access.treeId), isNull(persons.deletedAt)));
    return { persons: findSimilar(candidates, q, SIMILAR_LIMIT).map(toSummary) };
  });
};
