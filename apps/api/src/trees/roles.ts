import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { branchStewards, treeMembers, trees } from '../db/schema.js';

/** Owners (of any tree, even a deleted one) and stewards must keep 2FA on (spec §5). */
export async function holdsTwoFactorRole(db: Queryable, userId: string): Promise<boolean> {
  const [row] = (await db.execute(sql`
    select exists (select 1 from ${treeMembers} where user_id = ${userId} and role = 'owner')
        or exists (select 1 from ${branchStewards} where user_id = ${userId}) as held
  `)) as unknown as { held: boolean }[];
  return row?.held ?? false;
}

/**
 * Account deletion is blocked while the user owns a non-deleted tree (spec §5). An owner whose
 * trees are all soft-deleted may delete their account, which leaves an ownerless soft-deleted
 * tree: the phase 4 purge must not assume an owner exists.
 */
export async function ownsLiveTree(db: Queryable, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: trees.id })
    .from(treeMembers)
    .innerJoin(trees, eq(trees.id, treeMembers.treeId))
    .where(
      and(eq(treeMembers.userId, userId), eq(treeMembers.role, 'owner'), isNull(trees.deletedAt)),
    )
    .limit(1);
  return rows.length > 0;
}
