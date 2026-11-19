import {
  aliasBridge,
  FULL_VIEW_MAX,
  type PersonSummary,
  type PersonView,
  type TreeGraph,
} from '@family-tree/shared';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db, Queryable } from '../db/client.js';
import { treeLinks, treeMembers, trees } from '../db/schema.js';
import { notFound } from '../errors.js';
import type { ObjectStore } from '../storage/objects.js';
import { type Access, loadAccess } from './access.js';
import { type GraphRows, loadGraphRows } from './graph-rows.js';
import { withPhotoUrls } from './graph-view.js';
import { loadPersonView } from './person-view.js';
import {
  type Graph,
  loadLiveLinks,
  loadVisibility,
  maskGraphRows,
  visibilityOf,
  type Visibility,
} from './privacy.js';

export type LinkRow = typeof treeLinks.$inferSelect;

/** One link seen from one of its trees (tree linking spec, Terms). */
export interface LinkSide {
  link: LinkRow;
  side: 'a' | 'b';
  ownTreeId: string;
  otherTreeId: string;
  ownBridgeId: string;
  otherBridgeId: string;
  acceptedHere: boolean;
  acceptedThere: boolean;
  live: boolean;
}

export function sideOf(link: LinkRow, treeId: string): LinkSide {
  const a = link.treeAId === treeId;
  const acceptedA = link.aAcceptedAt !== null;
  const acceptedB = link.bAcceptedAt !== null;
  return {
    link,
    side: a ? 'a' : 'b',
    ownTreeId: treeId,
    otherTreeId: a ? link.treeBId : link.treeAId,
    ownBridgeId: a ? link.bridgePersonAId : link.bridgePersonBId,
    otherBridgeId: a ? link.bridgePersonBId : link.bridgePersonAId,
    acceptedHere: a ? acceptedA : acceptedB,
    acceptedThere: a ? acceptedB : acceptedA,
    live: link.endedAt === null && acceptedA && acceptedB,
  };
}

/**
 * Ends every open link of these trees whose bridge no longer holds (Lifecycle, automatic end):
 * a deleted tree, the bridge user gone from a tree, their card unlinked, relinked or deleted, or a
 * proposal past its 30 days. Called by the writes that can break a bridge, inside their own
 * transaction, and before links are read, so a link is never shown past its end.
 */
export async function reconcileLinks(db: Queryable, treeIds: readonly string[]): Promise<void> {
  if (treeIds.length === 0) return;
  const ids = sql`array[${sql.join(
    treeIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`;
  await db.execute(sql`
    with stale as (
      select l.id,
        case
          when ta.deleted_at is not null or tb.deleted_at is not null then 'tree_deleted'
          when ma.user_id is null or mb.user_id is null then 'bridge_left'
          when ma.person_id is distinct from l.bridge_person_a_id
            or mb.person_id is distinct from l.bridge_person_b_id
            or pa.deleted_at is not null or pb.deleted_at is not null then 'card_unlinked'
          else 'expired'
        end as reason
      from tree_links l
      join trees ta on ta.id = l.tree_a_id
      join trees tb on tb.id = l.tree_b_id
      join persons pa on pa.tree_id = l.tree_a_id and pa.id = l.bridge_person_a_id
      join persons pb on pb.tree_id = l.tree_b_id and pb.id = l.bridge_person_b_id
      left join tree_members ma on ma.tree_id = l.tree_a_id and ma.user_id = l.bridge_user_id
      left join tree_members mb on mb.tree_id = l.tree_b_id and mb.user_id = l.bridge_user_id
      where l.ended_at is null
        and (l.tree_a_id = any(${ids}) or l.tree_b_id = any(${ids}))
        and (
          ta.deleted_at is not null or tb.deleted_at is not null
          or ma.user_id is null or mb.user_id is null
          or ma.person_id is distinct from l.bridge_person_a_id
          or mb.person_id is distinct from l.bridge_person_b_id
          or pa.deleted_at is not null or pb.deleted_at is not null
          or ((l.a_accepted_at is null or l.b_accepted_at is null) and l.expires_at <= now())
        )
    )
    update tree_links set ended_at = now(), end_reason = stale.reason::tree_link_end_reason
    from stale where tree_links.id = stale.id`);
}

const ofTree = (treeId: string) => or(eq(treeLinks.treeAId, treeId), eq(treeLinks.treeBId, treeId));

/** The tree's pending and live links, after ending any whose bridge broke. */
export async function openLinksOf(db: Queryable, treeId: string): Promise<LinkSide[]> {
  await reconcileLinks(db, [treeId]);
  const rows = await db
    .select()
    .from(treeLinks)
    .where(and(ofTree(treeId), isNull(treeLinks.endedAt)))
    .orderBy(treeLinks.createdAt);
  return rows.map((r) => sideOf(r, treeId));
}

export async function liveLinksOf(db: Queryable, treeId: string): Promise<LinkSide[]> {
  return (await openLinksOf(db, treeId)).filter((s) => s.live);
}

/** A live link of `treeId`, or a 404 (pending, ended, or someone else's). */
export async function liveLink(db: Queryable, treeId: string, linkId: string): Promise<LinkSide> {
  const s = (await liveLinksOf(db, treeId)).find((x) => x.link.id === linkId);
  if (!s) throw notFound();
  return s;
}

/**
 * How the viewer (a member of the link's own tree) sees the other tree (V2, V3). A member of the
 * other tree keeps their own role and rules there. Anyone else is a visitor: a viewer with no card
 * and no grants, for whom each person's level applies, with steps counted from the viewer's own
 * card across the bridge.
 */
export async function linkedView(
  db: Db,
  viewer: Access,
  s: LinkSide,
): Promise<{ access: Access; vis: Visibility; rows: GraphRows; treeName: string }> {
  const rows = await loadGraphRows(db, s.otherTreeId);
  const [member] = await db
    .select({ userId: treeMembers.userId })
    .from(treeMembers)
    .where(and(eq(treeMembers.treeId, s.otherTreeId), eq(treeMembers.userId, viewer.userId)));
  if (member) {
    const access = await loadAccess(db, s.otherTreeId, viewer.userId);
    return { access, vis: await loadVisibility(db, access, rows), rows, treeName: access.treeName };
  }
  const [tree] = await db
    .select({ name: trees.name, rootPersonId: trees.rootPersonId })
    .from(trees)
    .where(and(eq(trees.id, s.otherTreeId), isNull(trees.deletedAt)));
  if (!tree) throw notFound();
  const access: Access = {
    userId: viewer.userId,
    treeId: s.otherTreeId,
    treeName: tree.name,
    rootPersonId: tree.rootPersonId,
    personId: null,
    role: 'viewer',
    twoFactorEnabled: false,
    heldGrants: [],
    grants: [],
    deletedAt: null,
  };
  const vis = await visibilityOf(db, {
    treeId: s.otherTreeId,
    exempt: () => false,
    from: viewer.personId,
    graph: async () => joinGraphs(await loadLiveLinks(db, s.ownTreeId), [joinedPart(rows, s)]),
  });
  return { access, vis, rows, treeName: tree.name };
}

/** The other tree's rows hanging off the own bridge card (V1). */
export const joinedPart = <R extends GraphRows | Graph>(rows: R, s: LinkSide): R =>
  aliasBridge(rows, s.otherBridgeId, s.ownBridgeId);

export function joinGraphs<G extends Graph>(own: G, parts: readonly Graph[]): G {
  return {
    ...own,
    unions: [...own.unions, ...parts.flatMap((p) => p.unions)],
    parentChild: [...own.parentChild, ...parts.flatMap((p) => p.parentChild)],
  };
}

/** The other tree as the canvas draws it next to the own tree: masked, joined, read-only. */
export async function linkedGraph(
  db: Db,
  viewer: Access,
  s: LinkSide,
  store: ObjectStore,
): Promise<{ graph: TreeGraph; treeName: string }> {
  const { vis, rows: raw, treeName } = await linkedView(db, viewer, s);
  const rows = joinedPart(maskGraphRows(raw, vis), s);
  if (rows.persons.length > FULL_VIEW_MAX) {
    return {
      treeName,
      graph: {
        mode: 'full',
        focusId: null,
        branchId: null,
        persons: [],
        unions: [],
        links: [],
        total: rows.persons.length,
        truncated: false,
        needsBranch: true,
      },
    };
  }
  const kids = new Map<string, number>();
  for (const l of rows.parentChild) kids.set(l.unionId, (kids.get(l.unionId) ?? 0) + 1);
  const withParents = new Set(
    rows.parentChild
      .filter((l) => {
        const u = rows.unions.find((x) => x.id === l.unionId);
        return u && (u.partnerAId !== null || u.partnerBId !== null);
      })
      .map((l) => l.childId),
  );
  const graph: TreeGraph = {
    mode: 'full',
    focusId: null,
    branchId: null,
    total: rows.persons.length,
    truncated: false,
    needsBranch: false,
    persons: rows.persons.map(({ photoThumbKey, ...p }) => ({
      ...(void photoThumbKey, p),
      hasParents: withParents.has(p.id),
      hiddenRelatives: false,
      canAddRelative: false,
      photoThumbUrl: null,
    })),
    unions: rows.unions.map((u) => ({ ...u, childCount: kids.get(u.id) ?? 0, canEdit: false })),
    links: rows.parentChild,
  };
  return { treeName, graph: await withPhotoUrls(graph, rows, store) };
}

/** One person of the other tree, view-only, with the bridge card shown as the own card (V1). */
export async function linkedPerson(
  db: Db,
  viewer: Access,
  s: LinkSide,
  personId: string,
  store: ObjectStore,
  limitBytes: number,
): Promise<{ view: PersonView; treeName: string }> {
  if (personId === s.otherBridgeId) throw notFound();
  const { access, vis, treeName } = await linkedView(db, viewer, s);
  const view = await loadPersonView(db, access, personId, store, limitBytes, vis);
  const swap = <T extends PersonSummary | null>(p: T): T =>
    p && p.id === s.otherBridgeId ? { ...p, id: s.ownBridgeId } : p;
  return {
    treeName,
    view: {
      ...view,
      relations: {
        parents: view.relations.parents.map((r) => ({
          ...r,
          parents: r.parents.map(swap),
          moveTo: [],
        })),
        unions: view.relations.unions.map((u) => ({
          ...u,
          partner: swap(u.partner),
          children: u.children.map((c) => ({ ...c, person: swap(c.person) })),
        })),
        siblings: view.relations.siblings.map((x) => ({ ...x, person: swap(x.person) })),
      },
      capabilities: { edit: false, addRelative: false, delete: false },
    },
  };
}
