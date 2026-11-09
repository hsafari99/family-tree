import {
  createTreeSchema,
  type FuzzyDate,
  sortYear,
  TREE_RESTORE_DAYS,
  type TreeDetail,
  type TreeList,
  updateTreeSchema,
} from '@family-tree/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Auth } from '../auth/auth.js';
import { requireSession } from '../auth/session-guard.js';
import type { Config } from '../config.js';
import type { Db, Queryable } from '../db/client.js';
import { persons, treeMembers, trees } from '../db/schema.js';
import { AppError, idParam, notFound, parseBody } from '../errors.js';
import { can, TREE } from '../permissions/can.js';
import { authorize, loadAccess } from '../trees/access.js';

export interface TreeRouteOptions {
  auth: Auth;
  db: Db;
  config: Config;
}

const RESTORE_MS = TREE_RESTORE_DAYS * 86_400_000;

async function ownedLiveTreeCount(db: Queryable, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(treeMembers)
    .innerJoin(trees, eq(trees.id, treeMembers.treeId))
    .where(
      and(eq(treeMembers.userId, userId), eq(treeMembers.role, 'owner'), isNull(trees.deletedAt)),
    );
  return row?.n ?? 0;
}

/** Serialises one user's tree creates and restores, so two at once can't both pass the limit. */
const lockUserTrees = (db: Queryable, userId: string) =>
  db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`trees:${userId}`}, 0))`);

export const treesRoutes: FastifyPluginAsync<TreeRouteOptions> = async (
  app,
  { auth, db, config },
) => {
  app.addHook('preHandler', requireSession(auth));

  const quotaError = () =>
    new AppError('QUOTA_EXCEEDED', 403, `You can own at most ${config.MAX_TREES_PER_USER} trees`);

  app.get('/api/v1/trees', async (req) => {
    const rows = await db
      .select({
        id: trees.id,
        name: trees.name,
        role: treeMembers.role,
        deletedAt: trees.deletedAt,
      })
      .from(treeMembers)
      .innerJoin(trees, eq(trees.id, treeMembers.treeId))
      .where(eq(treeMembers.userId, req.user!.id))
      .orderBy(asc(trees.name));
    const now = Date.now();
    const body: TreeList = { trees: [], deletedTrees: [] };
    for (const r of rows) {
      if (r.deletedAt === null) body.trees.push({ id: r.id, name: r.name, role: r.role });
      else if (r.role === 'owner' && now - r.deletedAt.getTime() < RESTORE_MS) {
        body.deletedTrees.push({
          id: r.id,
          name: r.name,
          deletedAt: r.deletedAt.toISOString(),
          restoreUntil: new Date(r.deletedAt.getTime() + RESTORE_MS).toISOString(),
        });
      }
    }
    return body;
  });

  app.post('/api/v1/trees', async (req, reply) => {
    const { name, person } = parseBody(createTreeSchema, req.body);
    const user = req.user!;
    if (!user.twoFactorEnabled) {
      throw new AppError(
        'TWO_FACTOR_REQUIRED',
        403,
        'Turn on two-step verification to start a tree',
      );
    }
    const treeId = await db.transaction(async (tx) => {
      await lockUserTrees(tx, user.id);
      if ((await ownedLiveTreeCount(tx, user.id)) >= config.MAX_TREES_PER_USER) throw quotaError();
      const [tree] = await tx.insert(trees).values({ name }).returning({ id: trees.id });
      const birthDate: FuzzyDate | null =
        person.birthYear === undefined
          ? null
          : { qualifier: 'exact', date1: String(person.birthYear).padStart(4, '0') };
      const [root] = await tx
        .insert(persons)
        .values({
          treeId: tree!.id,
          givenName: person.givenName,
          surname: person.surname ?? null,
          sex: person.sex,
          birthDate,
          birthSortYear: birthDate ? sortYear(birthDate) : null,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: persons.id });
      await tx.update(trees).set({ rootPersonId: root!.id }).where(eq(trees.id, tree!.id));
      await tx
        .insert(treeMembers)
        .values({ treeId: tree!.id, userId: user.id, role: 'owner', personId: root!.id });
      return tree!.id;
    });
    return reply.code(201).send({ tree: { id: treeId } });
  });

  app.get('/api/v1/trees/:treeId', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const body: TreeDetail = {
      tree: { id: access.treeId, name: access.treeName, rootPersonId: access.rootPersonId },
      me: {
        role: access.role,
        personId: access.personId,
        steward: { grants: access.heldGrants, active: access.grants.length > 0 },
      },
      capabilities: {
        editAnywhere: access.role !== 'viewer',
        manageTree: can(access, 'tree.rename', TREE),
        invite: can(access, 'invite.create', {
          kind: 'invite',
          role: 'viewer',
          stewardAnchorPersonId: null,
        }),
        grantStewardship: access.role === 'owner' || access.grants.length > 0,
      },
    };
    return body;
  });

  app.patch('/api/v1/trees/:treeId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    const input = parseBody(updateTreeSchema, req.body);
    if (input.name !== undefined) authorize(access, 'tree.rename', TREE);
    if (input.rootPersonId !== undefined) {
      authorize(access, 'tree.changeRoot', TREE);
      const [p] = await db
        .select({ id: persons.id })
        .from(persons)
        .where(
          and(
            eq(persons.treeId, access.treeId),
            eq(persons.id, input.rootPersonId),
            isNull(persons.deletedAt),
          ),
        );
      if (!p) {
        throw new AppError('VALIDATION', 400, 'Some fields are invalid', {
          rootPersonId: ['Choose a person in this tree'],
        });
      }
    }
    await db
      .update(trees)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.rootPersonId === undefined ? {} : { rootPersonId: input.rootPersonId }),
      })
      .where(eq(trees.id, access.treeId));
    return reply.code(204).send();
  });

  app.delete('/api/v1/trees/:treeId', async (req, reply) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.delete', TREE);
    await db
      .update(trees)
      .set({ deletedAt: sql`now()` })
      .where(eq(trees.id, access.treeId));
    return reply.code(204).send();
  });

  app.post('/api/v1/trees/:treeId/restore', async (req, reply) => {
    const userId = req.user!.id;
    const access = await loadAccess(db, idParam(req.params, 'treeId'), userId, {
      includeDeleted: true,
    });
    // Non-owners must not learn whether a deleted tree exists: 404, not 403.
    if (!can(access, 'tree.restore', TREE)) throw notFound();
    if (access.deletedAt === null) return reply.code(204).send();
    if (Date.now() - access.deletedAt.getTime() >= RESTORE_MS) throw notFound();
    await db.transaction(async (tx) => {
      await lockUserTrees(tx, userId);
      if ((await ownedLiveTreeCount(tx, userId)) >= config.MAX_TREES_PER_USER) throw quotaError();
      await tx.update(trees).set({ deletedAt: null }).where(eq(trees.id, access.treeId));
    });
    return reply.code(204).send();
  });

  app.get('/api/v1/trees/:treeId/persons', async (req) => {
    const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
    authorize(access, 'tree.view', TREE);
    const rows = await db
      .select({
        id: persons.id,
        givenName: persons.givenName,
        middleName: persons.middleName,
        surname: persons.surname,
        birthYear: persons.birthSortYear,
        deathYear: persons.deathSortYear,
        isLiving: persons.isLiving,
      })
      .from(persons)
      .where(and(eq(persons.treeId, access.treeId), isNull(persons.deletedAt)))
      .orderBy(asc(persons.surname), asc(persons.givenName));
    return { persons: rows };
  });
};
