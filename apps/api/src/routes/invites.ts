import {
  createInviteSchema,
  INVITE_TTL_DAYS,
  type Invite,
  type InvitePreview,
  inviteTokenSchema,
  ROLE_RANK,
} from '@family-tree/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import type { Queryable } from '../db/client.js';
import { branchStewards, invites, persons, treeMembers, trees, users } from '../db/schema.js';
import { AppError, forbidden, idParam, notFound, parseBody } from '../errors.js';
import { can, TREE } from '../permissions/can.js';
import { extraLimit } from '../security/limits.js';
import { hashToken, newToken } from '../security/tokens.js';
import { authorize, grantCovering, loadAccess } from '../trees/access.js';
import type { TreeRouteOptions } from './trees.js';

const invalidInvite = () =>
  new AppError('INVALID_INVITE', 400, 'This invite link is invalid, expired or already used');
const invalid = (field: string, message: string) =>
  new AppError('VALIDATION', 400, 'Some fields are invalid', { [field]: [message] });

/** Usable: unused, unrevoked, unexpired. */
const usable = () =>
  and(isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, sql`now()`));

async function livePerson(db: Queryable, treeId: string, personId: string) {
  const [p] = await db
    .select({ id: persons.id, givenName: persons.givenName, surname: persons.surname })
    .from(persons)
    .where(and(eq(persons.treeId, treeId), eq(persons.id, personId), isNull(persons.deletedAt)));
  return p;
}

/** A person card no member has claimed yet. */
async function claimable(db: Queryable, treeId: string, personId: string): Promise<boolean> {
  if (!(await livePerson(db, treeId, personId))) return false;
  const [m] = await db
    .select({ userId: treeMembers.userId })
    .from(treeMembers)
    .where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.personId, personId)));
  return !m;
}

export const invitesRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  const session = requireSession(auth);

  app.get('/api/v1/trees/:treeId/invites', { preHandler: session }, async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const all = can(access, 'invites.viewAll', TREE);
    // Owners see every open invite; active stewards see their own; everyone else is refused.
    if (!all && access.grants.length === 0) throw forbidden();
    const rows = await db
      .select({
        id: invites.id,
        role: invites.role,
        stewardAnchorPersonId: invites.stewardAnchorPersonId,
        targetPersonId: invites.targetPersonId,
        createdByUserId: invites.createdByUserId,
        createdByName: users.name,
        expiresAt: invites.expiresAt,
      })
      .from(invites)
      .innerJoin(users, eq(users.id, invites.createdByUserId))
      .where(
        and(
          eq(invites.treeId, access.treeId),
          usable(),
          all ? undefined : eq(invites.createdByUserId, access.userId),
        ),
      )
      .orderBy(invites.createdAt);
    const list: Invite[] = rows.map((r) => ({
      ...r,
      role: r.role === 'owner' ? 'editor' : r.role, // unreachable: CHECK invites_not_owner
      expiresAt: r.expiresAt.toISOString(),
    }));
    return { invites: list };
  });

  app.post(
    '/api/v1/trees/:treeId/invites',
    {
      preHandler: [
        session,
        extraLimit(app, { name: 'invite-create', max: 30, timeWindow: '1 hour', by: 'user' }),
      ],
    },
    async (req, reply) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      const input = parseBody(createInviteSchema, req.body);
      authorize(access, 'invite.create', { kind: 'invite', ...input });
      if (
        input.stewardAnchorPersonId &&
        !(await livePerson(db, access.treeId, input.stewardAnchorPersonId))
      ) {
        throw invalid('stewardAnchorPersonId', 'Choose a person in this tree');
      }
      if (input.targetPersonId && !(await claimable(db, access.treeId, input.targetPersonId))) {
        throw invalid('targetPersonId', 'Choose a person in this tree who has no account yet');
      }
      const token = newToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
      const [row] = await db
        .insert(invites)
        .values({
          tokenHash: hashToken(token),
          treeId: access.treeId,
          role: input.role,
          stewardAnchorPersonId: input.stewardAnchorPersonId,
          targetPersonId: input.targetPersonId,
          createdByUserId: access.userId,
          expiresAt,
        })
        .returning({ id: invites.id });
      return reply.code(201).send({ id: row!.id, token, expiresAt: expiresAt.toISOString() });
    },
  );

  app.delete(
    '/api/v1/trees/:treeId/invites/:inviteId',
    { preHandler: session },
    async (req, reply) => {
      const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
      const [inv] = await db
        .select({ id: invites.id, createdByUserId: invites.createdByUserId })
        .from(invites)
        .where(
          and(eq(invites.treeId, access.treeId), eq(invites.id, idParam(req.params, 'inviteId'))),
        );
      if (!inv) throw notFound();
      authorize(access, 'invite.revoke', {
        kind: 'ownInvite',
        createdByUserId: inv.createdByUserId,
      });
      await db
        .update(invites)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(invites.id, inv.id), isNull(invites.revokedAt), isNull(invites.usedAt)));
      return reply.code(204).send();
    },
  );

  // Public: the landing page shows what the invite is for before sign-up. The token is the secret.
  app.post(
    '/api/v1/invites/preview',
    { preHandler: extraLimit(app, { name: 'invite-preview', max: 30, timeWindow: '15 minutes' }) },
    async (req) => {
      const { token } = parseBody(inviteTokenSchema, req.body);
      const [row] = await db
        .select({
          treeName: trees.name,
          role: invites.role,
          inviterName: users.name,
          steward: sql<boolean>`${invites.stewardAnchorPersonId} is not null`,
          targetGiven: persons.givenName,
          targetSurname: persons.surname,
        })
        .from(invites)
        .innerJoin(trees, and(eq(trees.id, invites.treeId), isNull(trees.deletedAt)))
        .innerJoin(users, eq(users.id, invites.createdByUserId))
        .leftJoin(persons, and(eq(persons.id, invites.targetPersonId), isNull(persons.deletedAt)))
        .where(and(eq(invites.tokenHash, hashToken(token)), usable()));
      if (!row || row.role === 'owner') throw invalidInvite();
      const body: InvitePreview = {
        treeName: row.treeName,
        role: row.role,
        inviterName: row.inviterName,
        steward: row.steward,
        targetPersonName: row.targetGiven
          ? [row.targetGiven, row.targetSurname].filter(Boolean).join(' ')
          : null,
      };
      return body;
    },
  );

  app.post(
    '/api/v1/invites/accept',
    {
      preHandler: [
        extraLimit(app, { name: 'invite-accept', max: 10, timeWindow: '15 minutes' }),
        session,
      ],
    },
    async (req) => {
      const { token } = parseBody(inviteTokenSchema, req.body);
      const userId = req.user!.id;
      const treeId = await db.transaction(async (tx) => {
        // Claim the invite first: of two concurrent accepts, only one gets the row back.
        const [inv] = await tx
          .update(invites)
          .set({ usedAt: sql`now()`, usedByUserId: userId })
          .where(and(eq(invites.tokenHash, hashToken(token)), usable()))
          .returning();
        if (!inv || inv.role === 'owner' || inv.createdByUserId === userId) throw invalidInvite();

        // Re-authorise the creator now (decision 3). loadAccess also 404s a deleted tree.
        const creator = await loadAccess(tx, inv.treeId, inv.createdByUserId).catch(
          (e: unknown) => {
            if (e instanceof AppError && e.statusCode === 404) return null;
            throw e;
          },
        );
        const spec = {
          kind: 'invite' as const,
          role: inv.role,
          stewardAnchorPersonId: inv.stewardAnchorPersonId,
          targetPersonId: inv.targetPersonId,
        };
        if (!creator || !can(creator, 'invite.create', spec)) throw invalidInvite();
        if (
          inv.stewardAnchorPersonId &&
          !(await livePerson(tx, inv.treeId, inv.stewardAnchorPersonId))
        ) {
          throw invalidInvite();
        }

        // Serialise accepts per tree so two invites targeting the same person can't both
        // pass `claimable` and then hit tree_members_person_uq (a 500).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'accept:' + inv.treeId}))`);

        const [existing] = await tx
          .select()
          .from(treeMembers)
          .where(and(eq(treeMembers.treeId, inv.treeId), eq(treeMembers.userId, userId)));
        const personId =
          inv.targetPersonId &&
          !existing?.personId &&
          (await claimable(tx, inv.treeId, inv.targetPersonId))
            ? inv.targetPersonId
            : null;
        if (!existing) {
          await tx.insert(treeMembers).values({
            treeId: inv.treeId,
            userId,
            role: inv.role,
            personId,
            invitedByUserId: inv.createdByUserId,
          });
        } else if (existing.role !== 'owner') {
          // Only ever raise (spec §5). The owner's row is never touched.
          const role = ROLE_RANK[inv.role] > ROLE_RANK[existing.role] ? inv.role : existing.role;
          await tx
            .update(treeMembers)
            .set({ role, ...(personId ? { personId } : {}) })
            .where(and(eq(treeMembers.treeId, inv.treeId), eq(treeMembers.userId, userId)));
        }
        if (inv.stewardAnchorPersonId && existing?.role !== 'owner') {
          let parentGrantId: string | null = null;
          if (creator.role !== 'owner') {
            parentGrantId = grantCovering(creator, inv.stewardAnchorPersonId)?.id ?? null;
            if (!parentGrantId) throw invalidInvite();
            // Lock the parent so a concurrent revoke can't delete it before our insert.
            const [parent] = await tx
              .select({ id: branchStewards.id })
              .from(branchStewards)
              .where(eq(branchStewards.id, parentGrantId))
              .for('share');
            if (!parent) throw invalidInvite();
          }
          await tx
            .insert(branchStewards)
            .values({
              treeId: inv.treeId,
              userId,
              anchorPersonId: inv.stewardAnchorPersonId,
              grantedByUserId: creator.userId,
              parentGrantId,
            })
            .onConflictDoNothing();
        }
        return inv.treeId;
      });
      return { treeId };
    },
  );
};
