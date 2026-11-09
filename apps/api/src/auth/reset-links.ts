import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { resetLinks } from '../db/schema.js';
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

/** Atomically marks the link used; returns the user id, or null if invalid, expired or already used. */
export async function consumeResetLink(db: Db, token: string): Promise<string | null> {
  const [row] = await db
    .update(resetLinks)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(resetLinks.tokenHash, hashResetToken(token)),
        isNull(resetLinks.usedAt),
        gt(resetLinks.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: resetLinks.userId });
  return row?.userId ?? null;
}
