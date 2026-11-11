import {
  branchOf,
  FOCUS_VIEW_MAX,
  FULL_VIEW_MAX,
  kinIndex,
  neighbourhood,
  type ParsedGraphQuery,
  partnersOf,
  type TreeGraph,
  unionEnds,
  visibleRelations,
  withHiddenRelatives,
} from '@family-tree/shared';
import { notFound } from '../errors.js';
import { can } from '../permissions/can.js';
import { signThumbs } from '../photos/photos.js';
import type { ObjectStore } from '../storage/objects.js';
import type { Access } from './access.js';
import type { GraphRows } from './graph-rows.js';

/** Picks the people for the requested view and adds the per-item can() flags (decisions 1–5). */
export function buildTreeGraph(rows: GraphRows, access: Access, q: ParsedGraphQuery): TreeGraph {
  const live = new Set(rows.persons.map((p) => p.id));
  const kin = kinIndex(rows);
  let ids: ReadonlySet<string> = new Set();
  let focusId: string | null = null;
  let branchId: string | null = null;
  let truncated = false;
  let needsBranch = false;

  if (q.mode === 'focus') {
    focusId = q.focus ?? access.rootPersonId;
    if (focusId !== null) {
      if (!live.has(focusId)) throw notFound();
      ({ ids, truncated } = neighbourhood(kin, focusId, q.depth, FOCUS_VIEW_MAX));
    }
  } else if (q.branch !== undefined) {
    if (!live.has(q.branch)) throw notFound();
    branchId = q.branch;
    const branch = branchOf(
      {
        persons: rows.persons.map((p) => ({ id: p.id, createdBy: null })),
        unions: rows.unions,
        parentChild: rows.parentChild,
      },
      q.branch,
      null, // rule 5 is about a steward's own additions, not about viewing (decision 4)
    );
    ({ ids, truncated } = neighbourhood(
      kin,
      q.branch,
      Number.POSITIVE_INFINITY,
      FULL_VIEW_MAX,
      branch,
    ));
  } else if (rows.persons.length > FULL_VIEW_MAX) {
    needsBranch = true;
  } else {
    ids = live;
  }

  const { unionIds, linkIds } = visibleRelations(rows, ids);
  const hidden = withHiddenRelatives(kin, ids);
  const unionById = new Map(rows.unions.map((u) => [u.id, u]));
  const kidsOf = new Map<string, string[]>();
  for (const l of rows.parentChild)
    kidsOf.set(l.unionId, [...(kidsOf.get(l.unionId) ?? []), l.childId]);
  // Has a recorded parent: a link to a union with at least one partner (brief #11).
  const hasParents = new Set(
    rows.parentChild
      .filter((l) => partnersOf(unionById.get(l.unionId)!).length > 0)
      .map((l) => l.childId),
  );

  return {
    mode: q.mode,
    focusId,
    branchId,
    total: rows.persons.length,
    truncated,
    needsBranch,
    persons: rows.persons
      .filter((p) => ids.has(p.id))
      .map(({ photoThumbKey, ...p }) => ({
        ...(void photoThumbKey, p),
        hasParents: hasParents.has(p.id),
        hiddenRelatives: hidden.has(p.id),
        canAddRelative: can(access, 'person.add', { kind: 'relation', ends: [p.id] }),
        photoThumbUrl: null,
      })),
    unions: rows.unions
      .filter((u) => unionIds.has(u.id))
      .map((u) => ({
        ...u,
        childCount: kidsOf.get(u.id)?.length ?? 0,
        canEdit: can(access, 'relation.edit', {
          kind: 'relation',
          ends: unionEnds(u, kidsOf.get(u.id) ?? []),
        }),
      })),
    links: rows.parentChild.filter((l) => linkIds.has(l.id)),
  };
}

/** Signs the primary thumbnails of the people in the view (decision 17); layout never sees them. */
export async function withPhotoUrls(
  graph: TreeGraph,
  rows: GraphRows,
  store: ObjectStore,
): Promise<TreeGraph> {
  const keyOf = new Map(rows.persons.map((p) => [p.id, p.photoThumbKey]));
  const urls = await signThumbs(
    store,
    graph.persons.map((p) => keyOf.get(p.id) ?? null),
  );
  return { ...graph, persons: graph.persons.map((p, i) => ({ ...p, photoThumbUrl: urls[i]! })) };
}
