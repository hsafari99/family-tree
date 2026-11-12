import {
  ACTIVITY_LIMIT,
  type ActivityEntry,
  type AuditAction,
  HISTORY_ACTION_PREFIXES,
  homeQuerySchema,
  type HomeSummary,
  TREE_RESTORE_DAYS,
} from '@family-tree/shared';
import { and, asc, count, eq, inArray, isNull, like, max, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { auditLog, branchStewards, invites, persons, treeMembers, trees } from '../db/schema.js';
import { parseBody } from '../errors.js';
import { extraLimit } from '../security/limits.js';
import { loadAccess } from '../trees/access.js';
import type { TreeRouteOptions } from './trees.js';

const RESTORE_MS = TREE_RESTORE_DAYS * 86_400_000;

/** A tree's "last updated" counts changes to its people and relations, and to the tree itself. */
const CHANGE_PREFIXES = [...HISTORY_ACTION_PREFIXES, 'tree.'] as const;

const usableInvite = () =>
  and(isNull(invites.usedAt), isNull(invites.revokedAt), sql`${invites.expiresAt} > now()`);

/**
 * The home dashboard in one read (UX round 1, batch 6): the caller's trees with their people
 * count, last change and open invites, the deleted trees they can restore, and recent changes
 * across their trees. Every row is reached through the caller's own tree_members rows, so other
 * trees never appear; `?treeId=` narrows it to one tree and is a 404 for anyone outside it.
 */
export const homeRoutes: FastifyPluginAsync<TreeRouteOptions> = async (app, { auth, db }) => {
  app.addHook('preHandler', requireSession(auth));

  app.get(
    '/api/v1/home',
    { preHandler: extraLimit(app, { name: 'home', max: 60, timeWindow: '1 minute', by: 'user' }) },
    async (req) => {
      const user = req.user!;
      const { treeId } = parseBody(homeQuerySchema, req.query);
      // Not a member, or the tree is deleted: 404, the same as a tree that doesn't exist.
      if (treeId) await loadAccess(db, treeId, user.id);

      const rows = await db
        .select({
          id: trees.id,
          name: trees.name,
          role: treeMembers.role,
          createdAt: trees.createdAt,
          deletedAt: trees.deletedAt,
        })
        .from(treeMembers)
        .innerJoin(trees, eq(trees.id, treeMembers.treeId))
        .where(and(eq(treeMembers.userId, user.id), treeId ? eq(trees.id, treeId) : undefined))
        .orderBy(asc(trees.name));
      const live = rows.filter((r) => r.deletedAt === null);
      const ids = live.map((r) => r.id);
      const now = Date.now();
      const deletedTrees = rows.flatMap((r) =>
        r.deletedAt !== null && r.role === 'owner' && now - r.deletedAt.getTime() < RESTORE_MS
          ? [
              {
                id: r.id,
                name: r.name,
                deletedAt: r.deletedAt.toISOString(),
                restoreUntil: new Date(r.deletedAt.getTime() + RESTORE_MS).toISOString(),
              },
            ]
          : [],
      );
      if (ids.length === 0) return { trees: [], deletedTrees, activity: [] } satisfies HomeSummary;

      const owned = live.filter((r) => r.role === 'owner').map((r) => r.id);
      const others = live.filter((r) => r.role !== 'owner').map((r) => r.id);
      const [people, changes, held, allInvites, ownInvites, activity] = await Promise.all([
        db
          .select({ treeId: persons.treeId, n: count() })
          .from(persons)
          .where(and(inArray(persons.treeId, ids), isNull(persons.deletedAt)))
          .groupBy(persons.treeId),
        db
          .select({ treeId: auditLog.treeId, at: max(auditLog.createdAt) })
          .from(auditLog)
          .where(
            and(
              inArray(auditLog.treeId, ids),
              or(...CHANGE_PREFIXES.map((p) => like(auditLog.action, `${p}%`))),
            ),
          )
          .groupBy(auditLog.treeId),
        // A steward grant applies only with 2FA on (spec §4); then they see their own invites.
        others.length > 0 && user.twoFactorEnabled
          ? db
              .selectDistinct({ treeId: branchStewards.treeId })
              .from(branchStewards)
              .where(
                and(eq(branchStewards.userId, user.id), inArray(branchStewards.treeId, others)),
              )
          : Promise.resolve([]),
        owned.length > 0
          ? db
              .select({ treeId: invites.treeId, n: count() })
              .from(invites)
              .where(and(inArray(invites.treeId, owned), usableInvite()))
              .groupBy(invites.treeId)
          : Promise.resolve([]),
        others.length > 0
          ? db
              .select({ treeId: invites.treeId, n: count() })
              .from(invites)
              .where(
                and(
                  inArray(invites.treeId, others),
                  eq(invites.createdByUserId, user.id),
                  usableInvite(),
                ),
              )
              .groupBy(invites.treeId)
          : Promise.resolve([]),
        recentActivity(db, ids),
      ]);

      const peopleOf = new Map(people.map((r) => [r.treeId, r.n]));
      const changedAt = new Map(changes.map((r) => [r.treeId, r.at]));
      const stewardOf = new Set(held.map((r) => r.treeId));
      const invitesOf = new Map([...allInvites, ...ownInvites].map((r) => [r.treeId, r.n]));
      const body: HomeSummary = {
        trees: live.map((r) => ({
          id: r.id,
          name: r.name,
          role: r.role,
          peopleCount: peopleOf.get(r.id) ?? 0,
          updatedAt: (changedAt.get(r.id) ?? r.createdAt).toISOString(),
          openInvites:
            r.role === 'owner' || stewardOf.has(r.id) ? (invitesOf.get(r.id) ?? 0) : null,
        })),
        deletedTrees,
        activity,
      };
      return body;
    },
  );
};

/**
 * The newest changes in these trees that a member could also find in someone's History: only
 * people and relation rows (decision 13), and only those that still concern a live person, who
 * names the entry (the first live one in the row's person list).
 */
async function recentActivity(
  db: TreeRouteOptions['db'],
  treeIds: string[],
): Promise<ActivityEntry[]> {
  const prefixes = sql.join(
    HISTORY_ACTION_PREFIXES.map((p) => sql`a.action like ${`${p}%`}`),
    sql` or `,
  );
  const ids = sql.join(
    treeIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute<{
    id: string;
    tree_id: string;
    tree_name: string;
    action: AuditAction;
    created_at: string | Date;
    by_name: string | null;
    person_id: string;
    person_name: string;
  }>(sql`
    select a.id, a.tree_id, t.name as tree_name, a.action, a.created_at, u.name as by_name,
           p.id as person_id,
           concat_ws(' ', p.given_name, p.middle_name, p.surname) as person_name
    from audit_log a
    join trees t on t.id = a.tree_id
    left join users u on u.id = a.user_id
    join lateral (
      select p.id, p.given_name, nullif(p.middle_name, '') as middle_name,
             nullif(p.surname, '') as surname
      from persons p
      where p.tree_id = a.tree_id and p.id = any(a.person_ids) and p.deleted_at is null
      order by array_position(a.person_ids, p.id)
      limit 1
    ) p on true
    where a.tree_id in (${ids}) and (${prefixes})
    order by a.created_at desc, a.id desc
    limit ${ACTIVITY_LIMIT}
  `);
  return rows.map((r) => ({
    id: r.id,
    treeId: r.tree_id,
    treeName: r.tree_name,
    action: r.action,
    at: new Date(r.created_at).toISOString(),
    by: r.by_name,
    person: { id: r.person_id, name: r.person_name },
  }));
}
