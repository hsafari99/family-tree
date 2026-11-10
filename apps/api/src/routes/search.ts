import {
  type KinStep,
  kinPathsFrom,
  relationshipPath,
  relationshipQuerySchema,
  searchQuerySchema,
} from '@family-tree/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { idParam, notFound, parseBody } from '../errors.js';
import { TREE } from '../permissions/can.js';
import { signThumbs } from '../photos/photos.js';
import { extraLimit } from '../security/limits.js';
import { authorize, loadAccess } from '../trees/access.js';
import { loadGraphRows } from '../trees/graph-rows.js';
import { requireLivePerson } from '../trees/people.js';
import { searchPersons } from '../trees/search.js';
import type { TreeRouteOptions } from './trees.js';

export const searchRoutes: FastifyPluginAsync<TreeRouteOptions> = async (
  app,
  { auth, db, storage },
) => {
  app.addHook('preHandler', requireSession(auth));

  /** Spec §6 search box (decision 18). */
  app.get(
    '/api/v1/trees/:treeId/search',
    {
      preHandler: extraLimit(app, { name: 'search', max: 120, timeWindow: '1 minute', by: 'user' }),
    },
    async (req) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      authorize(access, 'tree.view', TREE);
      const q = parseBody(searchQuerySchema, req.query);
      if (q.branch) await requireLivePerson(db, access.treeId, q.branch);
      const rows = await searchPersons(db, access.treeId, q);
      let pathTo: ((id: string) => KinStep[] | null) | null = null;
      if (access.personId && rows.length > 0) {
        const graph = await loadGraphRows(db, access.treeId);
        if (graph.persons.some((p) => p.id === access.personId)) {
          pathTo = kinPathsFrom(graph, access.personId);
        }
      }
      // Access was checked above: the signed-URL cache is shared across users.
      const urls = await signThumbs(
        storage,
        rows.map((r) => r.photoThumbKey),
      );
      return {
        results: rows.map(({ photoThumbKey, ...p }, i) => ({
          ...(void photoThumbKey, p),
          photoThumbUrl: urls[i]!,
          relation: pathTo ? pathTo(p.id) : null,
        })),
      };
    },
  );

  /** Spec §6 "How are we related?" (decision 20). */
  app.get(
    '/api/v1/trees/:treeId/relationship',
    {
      preHandler: extraLimit(app, {
        name: 'relationship',
        max: 60,
        timeWindow: '1 minute',
        by: 'user',
      }),
    },
    async (req) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      authorize(access, 'tree.view', TREE);
      const { from, to } = parseBody(relationshipQuerySchema, req.query);
      const rows = await loadGraphRows(db, access.treeId);
      const byId = new Map(rows.persons.map((p) => [p.id, p]));
      if (!byId.has(from) || !byId.has(to)) throw notFound();
      const steps = relationshipPath(rows, from, to);
      const people = [from, ...(steps ?? []).map((s) => s.personId)].map((id) => byId.get(id)!);
      const urls = await signThumbs(
        storage,
        people.map((p) => p.photoThumbKey),
      );
      return {
        steps,
        persons: people.map(
          ({ id, givenName, middleName, surname, birthYear, deathYear, isLiving, sex }, i) => ({
            id,
            givenName,
            middleName,
            surname,
            birthYear,
            deathYear,
            isLiving,
            sex,
            photoThumbUrl: urls[i]!,
          }),
        ),
      };
    },
  );
};
