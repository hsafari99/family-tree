import {
  claimPersonSchema,
  type Member,
  ROLE_RANK,
  transferSchema,
  updateMemberSchema,
} from '@family-tree/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { createResetLink } from '../auth/reset-links.js';
import { requireSession } from '../auth/session-guard.js';
import type { Queryable } from '../db/client.js';
import { branchStewards, invites, persons, treeMembers, users } from '../db/schema.js';
import { AppError, idParam, isUniqueViolation, notFound, parseBody } from '../errors.js';
import { can, TREE } from '../permissions/can.js';
import { extraLimit } from '../security/limits.js';
import { authorize, loadAccess } from '../trees/access.js';
import { audit } from '../trees/audit.js';
import { grantClosure } from '../trees/grants.js';
import { lockUserTrees, ownedLiveTreeCount } from '../trees/quota.js';
import type { TreeRouteOptions } from './trees.js';

const resetNotAllowed = () =>
  new AppError(
    'RESET_LINK_NOT_ALLOWED',
    403,
    'A reset link can only be issued for a member without two-step verification who belongs only to trees you own',
  );

const personClaimed = () =>
  new AppError('PERSON_CLAIMED', 409, 'Another member is already linked to that person');

/**
 * Links `userId` to `personId` (or unlinks with null) inside `tx`: the person must be live in the
 * tree and no other member's. Takes the per-tree accept lock, so it serialises with invite accepts
 * that link a card; the unique index still backs it (a violation becomes PERSON_CLAIMED, not a 500).
 */
async function linkPerson(
  tx: Queryable,
  treeId: string,
  userId: string,
  personId: string | null,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'accept:' + treeId}))`);
  if (personId !== null) {
    // FOR SHARE: the person can't be soft-deleted (which clears links) before the update lands.
    const [p] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.treeId, treeId), eq(persons.id, personId), isNull(persons.deletedAt)))
      .for('share');
    if (!p) throw notFound();
    const [holder] = await tx
      .select({ userId: treeMembers.userId })
      .from(treeMembers)
      .where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.personId, personId)));
    if (holder && holder.userId !== userId) throw personClaimed();
  }
  try {
    await tx
      .update(treeMembers)
      .set({ personId })
      .where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, userId)));
  } catch (e) {
    if (isUniqueViolation(e)) throw personClaimed();
    throw e;
  }
}

/** The member row of `userId` in `treeId`, with their 2FA status, or 404. */
async function loadMember(db: Queryable, treeId: string, userId: string) {
  const [m] = await db
    .select({
      userId: treeMembers.userId,
      role: treeMembers.role,
      personId: treeMembers.personId,
      invitedByUserId: treeMembers.invitedByUserId,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(treeMembers)
    .innerJoin(users, eq(users.id, treeMembers.userId))
    .where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, userId)));
  if (!m) throw notFound();
  return m;
}

export const membersRoutes: FastifyPluginAsync<TreeRouteOptions> = async (
  app,
  { auth, db, config },
) => {
  app.addHook('preHandler', requireSession(auth));

  app.get('/api/v1/trees/:treeId/members', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const details = can(access, 'members.viewDetails', TREE);
    const rows = await db
      .select({
        userId: treeMembers.userId,
        name: users.name,
        email: users.email,
        twoFactorEnabled: users.twoFactorEnabled,
        role: treeMembers.role,
        personId: treeMembers.personId,
        invitedByUserId: treeMembers.invitedByUserId,
        joinedAt: treeMembers.createdAt,
      })
      .from(treeMembers)
      .innerJoin(users, eq(users.id, treeMembers.userId))
      .where(eq(treeMembers.treeId, access.treeId));
    rows.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name));
    const members: Member[] = rows.map(({ email, twoFactorEnabled, joinedAt, ...m }) => ({
      ...m,
      joinedAt: joinedAt.toISOString(),
      ...(details ? { email, twoFactorEnabled } : {}),
    }));
    return { members };
  });

  app.patch('/api/v1/trees/:treeId/members/:userId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const { role, personId } = parseBody(updateMemberSchema, req.body);
    const target = await loadMember(db, access.treeId, idParam(req.params, 'userId'));
    if (role !== undefined) authorize(access, 'member.changeRole', { kind: 'member', ...target });
    if (personId !== undefined) authorize(access, 'member.link', TREE);
    await db.transaction(async (tx) => {
      if (role !== undefined) {
        await tx
          .update(treeMembers)
          .set({ role })
          .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, target.userId)));
        await audit(tx, access, {
          action: 'member.role',
          entityType: 'member',
          entityId: target.userId,
          before: { role: target.role },
          after: { role },
        });
      }
      if (personId !== undefined && personId !== target.personId) {
        await linkPerson(tx, access.treeId, target.userId, personId);
        // Member changes never go in a person's History (audit.ts), so no personIds.
        await audit(tx, access, {
          action: 'member.link',
          entityType: 'member',
          entityId: target.userId,
          before: { personId: target.personId },
          after: { personId },
        });
      }
    });
    return reply.code(204).send();
  });

  // "This is me": a member with no card picks one nobody has claimed. Any role may; changing it
  // afterwards is the owner's (PATCH above), so a wrong pick can be fixed but not hopped around.
  app.post('/api/v1/trees/:treeId/me/person', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const { personId } = parseBody(claimPersonSchema, req.body);
    const alreadyLinked = () =>
      new AppError('ALREADY_LINKED', 409, 'You are already linked to a person in this tree');
    if (access.personId !== null) throw alreadyLinked();
    await db.transaction(async (tx) => {
      // Re-check under the accept lock (linkPerson takes it again; it is re-entrant): an owner's
      // link or an invite accept may have landed since loadAccess.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'accept:' + access.treeId}))`);
      const [me] = await tx
        .select({ personId: treeMembers.personId })
        .from(treeMembers)
        .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, access.userId)));
      if (!me) throw notFound();
      if (me.personId !== null) throw alreadyLinked();
      await linkPerson(tx, access.treeId, access.userId, personId);
      await audit(tx, access, {
        action: 'member.link',
        entityType: 'member',
        entityId: access.userId,
        before: { personId: null },
        after: { personId, self: true },
      });
    });
    return reply.code(204).send();
  });

  app.delete('/api/v1/trees/:treeId/members/:userId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const target = await loadMember(db, access.treeId, idParam(req.params, 'userId'));
    authorize(access, 'member.remove', { kind: 'member', ...target });
    await db.transaction(async (tx) => {
      // Their open invites lose the authority they were made with.
      await tx
        .update(invites)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(invites.treeId, access.treeId),
            eq(invites.createdByUserId, target.userId),
            isNull(invites.usedAt),
            isNull(invites.revokedAt),
          ),
        );
      // Grants go with the member row (FK), and grants derived from them cascade.
      const doomed = await grantClosure(tx, access.treeId, (g) => g.userId === target.userId);
      await tx
        .delete(treeMembers)
        .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, target.userId)));
      await audit(tx, access, {
        action: 'member.remove',
        entityType: 'member',
        entityId: target.userId,
        before: { role: target.role },
      });
      for (const g of doomed) {
        await audit(tx, access, {
          action: 'steward.revoke',
          entityType: 'grant',
          entityId: g.id,
          before: { userId: g.userId },
          after: { reason: 'member removed' },
        });
      }
    });
    return reply.code(204).send();
  });

  app.post('/api/v1/trees/:treeId/transfer', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.transfer', TREE);
    const { userId } = parseBody(transferSchema, req.body);
    if (userId === access.userId) {
      throw new AppError('VALIDATION', 400, 'Some fields are invalid', {
        userId: ['Choose another member'],
      });
    }
    await loadMember(db, access.treeId, userId);
    await db.transaction(async (tx) => {
      // The new owner's quota, serialised with their creates and restores.
      await lockUserTrees(tx, userId);
      // Lock the caller's row and confirm they are still the owner (a concurrent transfer loses).
      const [me] = await tx
        .select({ role: treeMembers.role })
        .from(treeMembers)
        .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, access.userId)))
        .for('update');
      if (me?.role !== 'owner') throw notFound();
      const [target] = await tx
        .select({ twoFactorEnabled: users.twoFactorEnabled })
        .from(treeMembers)
        .innerJoin(users, eq(users.id, treeMembers.userId))
        .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, userId)))
        .for('update', { of: treeMembers });
      if (!target) throw notFound();
      if (!target.twoFactorEnabled) {
        throw new AppError(
          'TWO_FACTOR_REQUIRED',
          403,
          'The new owner needs to turn on two-step verification first',
        );
      }
      if ((await ownedLiveTreeCount(tx, userId)) >= config.MAX_TREES_PER_USER) {
        throw new AppError(
          'QUOTA_EXCEEDED',
          403,
          `You can own at most ${config.MAX_TREES_PER_USER} trees`,
        );
      }
      // Grants the new owner made as a steward become owner-made (parent null),
      // so deleting the new owner's own grants below doesn't cascade to them.
      const ownGrants = tx
        .select({ id: branchStewards.id })
        .from(branchStewards)
        .where(and(eq(branchStewards.treeId, access.treeId), eq(branchStewards.userId, userId)));
      await tx
        .update(branchStewards)
        .set({ parentGrantId: null })
        .where(inArray(branchStewards.parentGrantId, ownGrants));
      // The old owner's open invites could no longer be accepted (re-auth fails); revoke them.
      await tx
        .update(invites)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(invites.treeId, access.treeId),
            eq(invites.createdByUserId, access.userId),
            isNull(invites.usedAt),
            isNull(invites.revokedAt),
          ),
        );
      // Demote first: the one-owner index is checked row by row.
      await tx
        .update(treeMembers)
        .set({ role: 'editor' })
        .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, access.userId)));
      await tx
        .update(treeMembers)
        .set({ role: 'owner' })
        .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, userId)));
      // Derived grants were detached above, so this is the new owner's own grants only.
      const ownDoomed = await grantClosure(tx, access.treeId, (g) => g.userId === userId, {
        lock: true,
      });
      await tx
        .delete(branchStewards)
        .where(and(eq(branchStewards.treeId, access.treeId), eq(branchStewards.userId, userId)));
      await audit(tx, access, {
        action: 'ownership.transfer',
        entityType: 'member',
        entityId: userId,
        before: { ownerUserId: access.userId },
        after: { ownerUserId: userId },
      });
      for (const g of ownDoomed) {
        await audit(tx, access, {
          action: 'steward.revoke',
          entityType: 'grant',
          entityId: g.id,
          before: { userId },
          after: { reason: 'became owner' },
        });
      }
    });
    return reply.code(204).send();
  });

  app.post(
    '/api/v1/trees/:treeId/members/:userId/reset-link',
    {
      preHandler: extraLimit(app, {
        name: 'reset-link-issue',
        max: 10,
        timeWindow: '1 hour',
        by: 'user',
      }),
    },
    async (req, reply) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      authorize(access, 'member.resetLink', TREE);
      const target = await loadMember(db, access.treeId, idParam(req.params, 'userId'));
      if (target.userId === access.userId || target.twoFactorEnabled) throw resetNotAllowed();
      // Spec §5: the target may belong to no tree other than trees this owner owns.
      const foreign = (await db.execute(sql`
        select 1 from ${treeMembers} m
        where m.user_id = ${target.userId}
          and not exists (
            select 1 from ${treeMembers} o
            where o.tree_id = m.tree_id and o.user_id = ${access.userId} and o.role = 'owner'
          )
        limit 1
      `)) as unknown as unknown[];
      if (foreign.length > 0) throw resetNotAllowed();
      const { token, expiresAt } = await createResetLink(db, {
        userId: target.userId,
        createdByUserId: access.userId,
        treeId: access.treeId,
      });
      return reply.code(201).send({ token, expiresAt: expiresAt.toISOString() });
    },
  );
};
