import { grantStewardSchema, type StewardGrant } from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { branchStewards, persons, treeMembers, users } from '../db/schema.js';
import { AppError, forbidden, idParam, notFound, parseBody } from '../errors.js';
import { authorize, grantCovering, loadAccess } from '../trees/access.js';
import type { TreeRouteOptions } from './trees.js';

const invalid = (field: string, message: string) =>
  new AppError('VALIDATION', 400, 'Some fields are invalid', { [field]: [message] });

export const stewardsRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.get('/api/v1/trees/:treeId/stewards', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const grantee = alias(users, 'grantee');
    const granter = alias(users, 'granter');
    const rows = await db
      .select({
        id: branchStewards.id,
        userId: branchStewards.userId,
        userName: grantee.name,
        anchorPersonId: branchStewards.anchorPersonId,
        grantedByUserId: branchStewards.grantedByUserId,
        grantedByName: granter.name,
        parentGrantId: branchStewards.parentGrantId,
        active: grantee.twoFactorEnabled,
      })
      .from(branchStewards)
      .innerJoin(grantee, eq(grantee.id, branchStewards.userId))
      .leftJoin(granter, eq(granter.id, branchStewards.grantedByUserId))
      .where(eq(branchStewards.treeId, access.treeId))
      .orderBy(branchStewards.createdAt);
    const stewards: StewardGrant[] = rows;
    return { stewards };
  });

  app.post('/api/v1/trees/:treeId/stewards', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const { userId, anchorPersonId } = parseBody(grantStewardSchema, req.body);
    authorize(access, 'steward.grant', { kind: 'anchor', personId: anchorPersonId });
    if (userId === access.userId) throw invalid('userId', 'Choose another member');
    const [anchor] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(
        and(
          eq(persons.treeId, access.treeId),
          eq(persons.id, anchorPersonId),
          isNull(persons.deletedAt),
        ),
      );
    if (!anchor) throw invalid('anchorPersonId', 'Choose a person in this tree');
    const [member] = await db
      .select({ role: treeMembers.role })
      .from(treeMembers)
      .where(and(eq(treeMembers.treeId, access.treeId), eq(treeMembers.userId, userId)));
    if (!member) throw notFound();
    if (member.role === 'owner') throw invalid('userId', 'The owner already has full access');

    // The parent is the actor's own effective grant in this tree (never taken from the request).
    let parentGrantId: string | null = null;
    if (access.role !== 'owner') {
      const parent = grantCovering(access, anchorPersonId);
      if (!parent) throw forbidden();
      parentGrantId = parent.id;
    }
    const [row] = await db
      .insert(branchStewards)
      .values({
        treeId: access.treeId,
        userId,
        anchorPersonId,
        grantedByUserId: access.userId,
        parentGrantId,
      })
      .onConflictDoNothing()
      .returning({ id: branchStewards.id });
    if (!row) throw new AppError('CONFLICT', 409, 'They already look after this branch');
    return reply.code(201).send({ id: row.id });
  });

  app.delete('/api/v1/trees/:treeId/stewards/:grantId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const [grant] = await db
      .select({ id: branchStewards.id, grantedByUserId: branchStewards.grantedByUserId })
      .from(branchStewards)
      .where(
        and(
          eq(branchStewards.treeId, access.treeId),
          eq(branchStewards.id, idParam(req.params, 'grantId')),
        ),
      );
    if (!grant) throw notFound();
    authorize(access, 'steward.revoke', { kind: 'grant', grantedByUserId: grant.grantedByUserId });
    // Derived grants cascade through parent_grant_id (spec §4).
    await db.delete(branchStewards).where(eq(branchStewards.id, grant.id));
    return reply.code(204).send();
  });
};
