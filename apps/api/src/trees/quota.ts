import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { treeMembers, trees } from '../db/schema.js';

export async function ownedLiveTreeCount(db: Queryable, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(treeMembers)
    .innerJoin(trees, eq(trees.id, treeMembers.treeId))
    .where(
      and(eq(treeMembers.userId, userId), eq(treeMembers.role, 'owner'), isNull(trees.deletedAt)),
    );
  return row?.n ?? 0;
}

/** Serialises one user's tree creates, restores and incoming transfers, so two at once can't both pass the limit. */
export const lockUserTrees = (db: Queryable, userId: string) =>
  db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`trees:${userId}`}, 0))`);
