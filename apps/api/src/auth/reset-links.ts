import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { resetLinks, treeMembers, users } from '../db/schema.js';
import { hashToken, newToken } from '../security/tokens.js';

/** Only this hash is stored; the raw token exists only in the link given to the user. */
export const hashResetToken = hashToken;

export async function createResetLink(
  db: Db,
  {
    userId,
    createdByUserId,
    treeId = null,
    ttlHours = 24,
  }: { userId: string; createdByUserId: string | null; treeId?: string | null; ttlHours?: number },
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await db
    .insert(resetLinks)
    .values({ tokenHash: hashResetToken(token), userId, createdByUserId, treeId, expiresAt });
  return { token, expiresAt };
}

const INVALID = Symbol('invalid reset link');

/**
 * Atomically marks the link used; returns the user id, or null if invalid, expired or already
 * used. A link an owner issued (tree_id set) is re-checked in the same transaction against the
 * issue-time rule: the issuer still owns the tree, the target has no 2FA, and the target belongs
 * to no tree the issuer doesn't own. If it fails, the transaction rolls back and the link is invalid.
 */
export async function consumeResetLink(db: Db, token: string): Promise<string | null> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(resetLinks)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(resetLinks.tokenHash, hashResetToken(token)),
            isNull(resetLinks.usedAt),
            gt(resetLinks.expiresAt, sql`now()`),
          ),
        )
        .returning({
          userId: resetLinks.userId,
          treeId: resetLinks.treeId,
          issuerId: resetLinks.createdByUserId,
        });
      if (!row) return null;
      if (row.treeId !== null) {
        const ok = (await tx.execute(sql`
          select 1
          where ${row.issuerId}::uuid is not null
            and exists (
              select 1 from ${treeMembers} o
              where o.tree_id = ${row.treeId} and o.user_id = ${row.issuerId} and o.role = 'owner'
            )
            and exists (
              select 1 from ${users} u where u.id = ${row.userId} and not u.two_factor_enabled
            )
            and not exists (
              select 1 from ${treeMembers} m
              where m.user_id = ${row.userId}
                and not exists (
                  select 1 from ${treeMembers} o
                  where o.tree_id = m.tree_id and o.user_id = ${row.issuerId} and o.role = 'owner'
                )
            )
        `)) as unknown as unknown[];
        if (ok.length === 0) throw INVALID;
      }
      return row.userId;
    });
  } catch (e) {
    if (e === INVALID) return null;
    throw e;
  }
}
