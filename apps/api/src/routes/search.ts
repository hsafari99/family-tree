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
import { loadVisibility, maskGraphPerson, maskSummary } from '../trees/privacy.js';
import { searchPersons } from '../trees/search.js';
import { joinedPart, linkedView, liveLinksOf } from '../trees/links.js';
import type { GraphRows } from '../trees/graph-rows.js';
import type { Visibility } from '../trees/privacy.js';
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
      // R5: a filter on hidden data never matches the person it is hidden for. Only names
      // stay searchable; the birth-year filters also skip people whose year is hidden.
      const detailFilter =
        q.diedFrom !== undefined || q.diedTo !== undefined || q.status !== undefined || !!q.place;
      const yearFilter = q.bornFrom !== undefined || q.bornTo !== undefined;
      const find = async (treeId: string, vis: Visibility, skip?: string) =>
        (await searchPersons(db, treeId, q))
          .filter((r) => r.id !== skip)
          .filter((r) => !(detailFilter || yearFilter) || vis.full(r.id))
          .filter((r) => !yearFilter || vis.birthYear(r.id))
          .map((r) => {
            const m: typeof r & { restricted?: boolean } = maskSummary(r, vis);
            return m.restricted ? { ...m, photoThumbKey: null } : m;
          });
      const rows = await find(access.treeId, await loadVisibility(db, access));
      // Matches in linked trees (tree linking spec L8), under the visitor rules; a branch filter
      // names a person of this tree, so it doesn't reach them.
      const links = q.branch ? [] : await liveLinksOf(db, access.treeId);
      const own =
        access.personId || links.length > 0 ? await loadGraphRows(db, access.treeId) : null;
      const linked: {
        linkId: string;
        treeId: string;
        treeName: string;
        rows: typeof rows;
        graph: GraphRows;
      }[] = [];
      for (const s of links) {
        const view = await linkedView(db, access, s);
        const found = await find(s.otherTreeId, view.vis, s.otherBridgeId);
        if (found.length > 0) {
          linked.push({
            linkId: s.link.id,
            treeId: s.otherTreeId,
            treeName: view.treeName,
            rows: found,
            graph: joinedPart(view.rows, s),
          });
        }
      }
      const me = access.personId;
      const pathsIn = (graph: GraphRows | null) =>
        me && graph && graph.persons.some((p) => p.id === me) ? kinPathsFrom(graph, me) : null;
      const pathTo: ((id: string) => KinStep[] | null) | null =
        rows.length > 0 ? pathsIn(own) : null;
      // Access was checked above: the signed-URL cache is shared across users.
      const sign = async (list: typeof rows, paths: ((id: string) => KinStep[] | null) | null) => {
        const urls = await signThumbs(
          storage,
          list.map((r) => r.photoThumbKey),
        );
        return list.map(({ photoThumbKey, ...p }, i) => ({
          ...(void photoThumbKey, p),
          photoThumbUrl: urls[i]!,
          relation: paths ? paths(p.id) : null,
        }));
      };
      const results = await sign(rows, pathTo);
      if (links.length === 0) return { results };
      const inLinkedTrees = [];
      for (const l of linked) {
        const joined = own && {
          ...own,
          persons: [...own.persons, ...l.graph.persons],
          unions: [...own.unions, ...l.graph.unions],
          parentChild: [...own.parentChild, ...l.graph.parentChild],
        };
        for (const r of await sign(l.rows, pathsIn(joined))) {
          inLinkedTrees.push({ ...r, linkId: l.linkId, treeId: l.treeId, treeName: l.treeName });
        }
      }
      return { results, inLinkedTrees };
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
      const own = await loadGraphRows(db, access.treeId);
      const vis = await loadVisibility(db, access, own);
      const byId = new Map(own.persons.map((p) => [p.id, maskGraphPerson(p, vis)]));
      let rows = own;
      // Either end may be in a directly linked tree: the path runs on the joined graph (L8).
      if (!byId.has(from) || !byId.has(to)) {
        for (const s of await liveLinksOf(db, access.treeId)) {
          const view = await linkedView(db, access, s);
          const part = joinedPart(view.rows, s);
          for (const p of part.persons) byId.set(p.id, maskGraphPerson(p, view.vis));
          rows = {
            persons: [...rows.persons, ...part.persons],
            unions: [...rows.unions, ...part.unions],
            parentChild: [...rows.parentChild, ...part.parentChild],
          };
        }
      }
      if (!byId.has(from) || !byId.has(to)) throw notFound();
      const steps = relationshipPath(rows, from, to);
      // Virtual steps (a parents-unknown union, brief #11) name a union, not a person.
      const people = [from, ...(steps ?? []).filter((s) => !s.virtual).map((s) => s.personId)].map(
        (id) => byId.get(id)!,
      );
      const urls = await signThumbs(
        storage,
        people.map((p) => p.photoThumbKey),
      );
      return {
        steps,
        persons: people.map(
          (
            { id, givenName, middleName, surname, birthYear, deathYear, isLiving, sex, restricted },
            i,
          ) => ({
            id,
            givenName,
            middleName,
            surname,
            birthYear,
            deathYear,
            isLiving,
            sex,
            ...(restricted ? { restricted } : {}),
            photoThumbUrl: urls[i]!,
          }),
        ),
      };
    },
  );
};
