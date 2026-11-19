import {
  type LinkCandidate,
  type LinkRequest,
  proposeLinkSchema,
  TREE_LINK_PENDING_DAYS,
  TREE_LINKS_MAX,
  type TreeLink,
  type TreeLinkEndReason,
} from '@family-tree/shared';
import { and, count, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import type { Queryable, Tx } from '../db/client.js';
import { persons, treeLinks, treeMembers, trees, users } from '../db/schema.js';
import { AppError, forbidden, idParam, notFound, parseBody } from '../errors.js';
import { TREE } from '../permissions/can.js';
import { extraLimit } from '../security/limits.js';
import { type Access, authorize, loadAccess } from '../trees/access.js';
import { audit } from '../trees/audit.js';
import {
  linkedGraph,
  linkedPerson,
  liveLink,
  type LinkSide,
  openLinksOf,
  reconcileLinks,
  sideOf,
} from '../trees/links.js';
import type { TreeRouteOptions } from './trees.js';

const notLinked = () =>
  new AppError('NOT_LINKED', 409, 'You need your own card in both trees to link them');
const linkExists = () =>
  new AppError('LINK_EXISTS', 409, 'These trees are already linked, or a request is waiting');
const linkLimit = () =>
  new AppError('LINK_LIMIT', 409, `A tree can have at most ${TREE_LINKS_MAX} links`);

/** Serialises link writes per tree, in id order so two trees never deadlock. */
async function lockLinks(tx: Tx, treeIds: readonly string[]) {
  for (const id of [...treeIds].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'links:' + id}))`);
  }
}

/** Live people per tree, not counting the bridge card. */
async function peopleCounts(db: Queryable, treeIds: readonly string[]) {
  if (treeIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ treeId: persons.treeId, n: count() })
    .from(persons)
    .where(and(inArray(persons.treeId, [...treeIds]), isNull(persons.deletedAt)))
    .groupBy(persons.treeId);
  return new Map(rows.map((r) => [r.treeId, Math.max(0, r.n - 1)]));
}

async function treeNames(db: Queryable, treeIds: readonly string[]) {
  if (treeIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: trees.id, name: trees.name })
    .from(trees)
    .where(inArray(trees.id, [...treeIds]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function userNames(db: Queryable, userIds: readonly string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...userIds]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Writes the same entry to both trees' audit logs (Lifecycle, Audit). */
async function auditBoth(
  tx: Tx,
  userId: string,
  s: LinkSide,
  action: 'propose' | 'accept' | 'decline' | 'cancel' | 'end',
  after?: unknown,
) {
  for (const treeId of [s.ownTreeId, s.otherTreeId]) {
    await audit(
      tx,
      { treeId, userId },
      {
        action: `treeLink.${action}`,
        entityType: 'treeLink',
        entityId: s.link.id,
        after: after ?? null,
      },
    );
  }
}

async function endLink(tx: Tx, linkId: string, userId: string, reason: TreeLinkEndReason) {
  await tx
    .update(treeLinks)
    .set({ endedAt: sql`now()`, endedByUserId: userId, endReason: reason })
    .where(and(eq(treeLinks.id, linkId), isNull(treeLinks.endedAt)));
}

/** An open link of the caller's tree, re-read under the lock. */
async function openLink(tx: Tx, access: Access, linkId: string): Promise<LinkSide> {
  const [row] = await tx
    .select()
    .from(treeLinks)
    .where(
      and(
        eq(treeLinks.id, linkId),
        isNull(treeLinks.endedAt),
        or(eq(treeLinks.treeAId, access.treeId), eq(treeLinks.treeBId, access.treeId)),
      ),
    );
  if (!row) throw notFound();
  return sideOf(row, access.treeId);
}

/** Whether the caller may see a pending link: an owner of this tree, or its bridge. */
const seesPending = (access: Access, s: LinkSide) =>
  access.role === 'owner' || s.link.bridgeUserId === access.userId;

export const linksRoutes: FastifyPluginAsync<TreeRouteOptions> = async (
  app,
  { auth, db, config, storage },
) => {
  app.addHook('preHandler', requireSession(auth));

  app.get('/api/v1/trees/:treeId/links', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const sides = (await openLinksOf(db, access.treeId)).filter(
      (s) => s.live || seesPending(access, s),
    );
    const others = sides.map((s) => s.otherTreeId);
    const [names, counts, bridges] = await Promise.all([
      treeNames(db, others),
      peopleCounts(db, others),
      userNames(
        db,
        sides.map((s) => s.link.bridgeUserId),
      ),
    ]);
    const isOwner = access.role === 'owner';
    const links: TreeLink[] = sides.map((s) => {
      const isBridge = s.link.bridgeUserId === access.userId;
      return {
        id: s.link.id,
        status: s.live ? 'live' : 'pending',
        otherTree: { id: s.otherTreeId, name: names.get(s.otherTreeId) ?? '' },
        bridge: {
          userId: s.link.bridgeUserId,
          name: bridges.get(s.link.bridgeUserId) ?? '',
          personId: s.ownBridgeId,
          otherPersonId: s.otherBridgeId,
        },
        otherPeopleCount: counts.get(s.otherTreeId) ?? 0,
        acceptedHere: s.acceptedHere,
        acceptedThere: s.acceptedThere,
        canAccept: !s.live && isOwner && !s.acceptedHere,
        canEnd: isOwner || isBridge,
        createdAt: s.link.createdAt.toISOString(),
        expiresAt: s.link.expiresAt.toISOString(),
      };
    });
    return { links };
  });

  /** The caller's other trees where they have their own card and no open link to this one. */
  app.get('/api/v1/trees/:treeId/links/candidates', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    if (access.personId === null) return { candidates: [] };
    const open = new Set((await openLinksOf(db, access.treeId)).map((s) => s.otherTreeId));
    const mine = await db
      .select({ treeId: trees.id, name: trees.name })
      .from(treeMembers)
      .innerJoin(trees, eq(trees.id, treeMembers.treeId))
      .innerJoin(
        persons,
        and(eq(persons.treeId, treeMembers.treeId), eq(persons.id, treeMembers.personId)),
      )
      .where(
        and(
          eq(treeMembers.userId, access.userId),
          ne(treeMembers.treeId, access.treeId),
          isNull(trees.deletedAt),
          isNull(persons.deletedAt),
        ),
      )
      .orderBy(trees.name);
    const free = mine.filter((t) => !open.has(t.treeId));
    const counts = await peopleCounts(
      db,
      free.map((t) => t.treeId),
    );
    const candidates: LinkCandidate[] = free.map((t) => ({
      ...t,
      peopleCount: counts.get(t.treeId) ?? 0,
    }));
    return { candidates };
  });

  app.post(
    '/api/v1/trees/:treeId/links',
    {
      preHandler: extraLimit(app, {
        name: 'link-propose',
        max: 20,
        timeWindow: '1 hour',
        by: 'user',
      }),
    },
    async (req, reply) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      authorize(access, 'tree.view', TREE);
      const { otherTreeId } = parseBody(proposeLinkSchema, req.body);
      if (otherTreeId === access.treeId) throw notFound();
      const other = await loadAccess(db, otherTreeId, access.userId);
      if (access.personId === null || other.personId === null) throw notLinked();
      const id = await db.transaction(async (tx) => {
        await lockLinks(tx, [access.treeId, otherTreeId]);
        await reconcileLinks(tx, [access.treeId, otherTreeId]);
        // Re-read both cards under the lock: either may have been unlinked since loadAccess.
        const cards = await tx
          .select({
            treeId: treeMembers.treeId,
            personId: treeMembers.personId,
            role: treeMembers.role,
          })
          .from(treeMembers)
          .innerJoin(
            persons,
            and(eq(persons.treeId, treeMembers.treeId), eq(persons.id, treeMembers.personId)),
          )
          .innerJoin(trees, eq(trees.id, treeMembers.treeId))
          .where(
            and(
              eq(treeMembers.userId, access.userId),
              inArray(treeMembers.treeId, [access.treeId, otherTreeId]),
              isNull(persons.deletedAt),
              isNull(trees.deletedAt),
            ),
          );
        const own = cards.find((c) => c.treeId === access.treeId);
        const far = cards.find((c) => c.treeId === otherTreeId);
        if (!own?.personId || !far?.personId) throw notLinked();
        const [a, b] = access.treeId < otherTreeId ? [own, far] : [far, own];
        const open = await tx
          .select({ treeAId: treeLinks.treeAId, treeBId: treeLinks.treeBId })
          .from(treeLinks)
          .where(
            and(
              isNull(treeLinks.endedAt),
              or(
                inArray(treeLinks.treeAId, [a.treeId, b.treeId]),
                inArray(treeLinks.treeBId, [a.treeId, b.treeId]),
              ),
            ),
          );
        if (open.some((l) => l.treeAId === a.treeId && l.treeBId === b.treeId)) throw linkExists();
        for (const t of [a.treeId, b.treeId]) {
          if (open.filter((l) => l.treeAId === t || l.treeBId === t).length >= TREE_LINKS_MAX) {
            throw linkLimit();
          }
        }
        const now = new Date();
        const [row] = await tx
          .insert(treeLinks)
          .values({
            treeAId: a.treeId,
            treeBId: b.treeId,
            bridgeUserId: access.userId,
            bridgePersonAId: a.personId!,
            bridgePersonBId: b.personId!,
            proposedByUserId: access.userId,
            // The bridge's own tree agrees by proposing (L3).
            aAcceptedAt: a.role === 'owner' ? now : null,
            bAcceptedAt: b.role === 'owner' ? now : null,
            expiresAt: new Date(now.getTime() + TREE_LINK_PENDING_DAYS * 86_400_000),
          })
          .returning();
        await auditBoth(tx, access.userId, sideOf(row!, access.treeId), 'propose');
        return row!.id;
      });
      return reply.code(201).send({ id });
    },
  );

  app.post('/api/v1/trees/:treeId/links/:linkId/accept', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const linkId = idParam(req.params, 'linkId');
    await db.transaction(async (tx) => {
      await reconcileLinks(tx, [access.treeId]);
      const pre = await openLink(tx, access, linkId);
      await lockLinks(tx, [pre.ownTreeId, pre.otherTreeId]);
      const s = await openLink(tx, access, linkId);
      if (!seesPending(access, s)) throw notFound();
      if (access.role !== 'owner') throw forbidden('Only the tree’s owner can accept a link');
      if (s.acceptedHere) return;
      await tx
        .update(treeLinks)
        .set(s.side === 'a' ? { aAcceptedAt: sql`now()` } : { bAcceptedAt: sql`now()` })
        .where(eq(treeLinks.id, linkId));
      await auditBoth(tx, access.userId, s, 'accept', { treeId: access.treeId });
    });
    return reply.code(204).send();
  });

  app.post('/api/v1/trees/:treeId/links/:linkId/decline', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const linkId = idParam(req.params, 'linkId');
    await db.transaction(async (tx) => {
      await reconcileLinks(tx, [access.treeId]);
      const s = await openLink(tx, access, linkId);
      if (!seesPending(access, s)) throw notFound();
      if (access.role !== 'owner') throw forbidden('Only the tree’s owner can decline a link');
      if (s.live) throw notFound();
      await endLink(tx, linkId, access.userId, 'declined');
      await auditBoth(tx, access.userId, s, 'decline', { treeId: access.treeId });
    });
    return reply.code(204).send();
  });

  /** Cancels a pending link (its bridge) or ends a live one (an owner or the bridge). */
  app.delete('/api/v1/trees/:treeId/links/:linkId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const linkId = idParam(req.params, 'linkId');
    await db.transaction(async (tx) => {
      await reconcileLinks(tx, [access.treeId]);
      const s = await openLink(tx, access, linkId);
      const isBridge = s.link.bridgeUserId === access.userId;
      if (!s.live && !seesPending(access, s)) throw notFound();
      if (access.role !== 'owner' && !isBridge) throw forbidden();
      const reason = s.live ? 'ended' : isBridge ? 'cancelled' : 'declined';
      await endLink(tx, linkId, access.userId, reason);
      await auditBoth(
        tx,
        access.userId,
        s,
        reason === 'ended' ? 'end' : reason === 'cancelled' ? 'cancel' : 'decline',
        { treeId: access.treeId },
      );
    });
    return reply.code(204).send();
  });

  /** The other tree for the joined canvas (V1–V3). */
  app.get('/api/v1/trees/:treeId/links/:linkId/graph', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const s = await liveLink(db, access.treeId, idParam(req.params, 'linkId'));
    const { graph, treeName } = await linkedGraph(db, access, s, storage);
    return {
      linkId: s.link.id,
      tree: { id: s.otherTreeId, name: treeName },
      bridgePersonId: s.ownBridgeId,
      graph,
    };
  });

  app.get('/api/v1/trees/:treeId/links/:linkId/persons/:personId', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const s = await liveLink(db, access.treeId, idParam(req.params, 'linkId'));
    const { view, treeName } = await linkedPerson(
      db,
      access,
      s,
      idParam(req.params, 'personId'),
      storage,
      config.MAX_PHOTO_BYTES_PER_TREE,
    );
    return { tree: { id: s.otherTreeId, name: treeName }, view };
  });

  /** Proposals waiting for the caller as an owner, for the Home page notice. */
  app.get('/api/v1/home/link-requests', async (req) => {
    const userId = req.user!.id;
    const owned = (
      await db
        .select({ id: trees.id })
        .from(treeMembers)
        .innerJoin(trees, eq(trees.id, treeMembers.treeId))
        .where(
          and(
            eq(treeMembers.userId, userId),
            eq(treeMembers.role, 'owner'),
            isNull(trees.deletedAt),
          ),
        )
    ).map((t) => t.id);
    if (owned.length === 0) return { requests: [] };
    await reconcileLinks(db, owned);
    const rows = await db
      .select()
      .from(treeLinks)
      .where(
        and(
          isNull(treeLinks.endedAt),
          or(
            and(inArray(treeLinks.treeAId, owned), isNull(treeLinks.aAcceptedAt)),
            and(inArray(treeLinks.treeBId, owned), isNull(treeLinks.bAcceptedAt)),
          ),
        ),
      )
      .orderBy(treeLinks.createdAt);
    const sides = rows.flatMap((r) =>
      [r.treeAId, r.treeBId]
        .filter((t) => owned.includes(t))
        .map((t) => sideOf(r, t))
        .filter((s) => !s.acceptedHere),
    );
    const treeIds = [...new Set(sides.flatMap((s) => [s.ownTreeId, s.otherTreeId]))];
    const [names, counts, bridges] = await Promise.all([
      treeNames(db, treeIds),
      peopleCounts(db, treeIds),
      userNames(
        db,
        sides.map((s) => s.link.bridgeUserId),
      ),
    ]);
    const requests: LinkRequest[] = sides.map((s) => ({
      linkId: s.link.id,
      treeId: s.ownTreeId,
      treeName: names.get(s.ownTreeId) ?? '',
      otherTreeName: names.get(s.otherTreeId) ?? '',
      bridgeName: bridges.get(s.link.bridgeUserId) ?? '',
      otherPeopleCount: counts.get(s.otherTreeId) ?? 0,
    }));
    return { requests };
  });
};
