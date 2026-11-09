import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { resetLinks } from '../db/schema.js';

/** Only this hash is stored; the raw token exists only in the link given to the user. */
export const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createResetLink(
  db: Db,
  {
    userId,
    createdByUserId,
    ttlHours = 24,
  }: { userId: string; createdByUserId: string | null; ttlHours?: number },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await db
    .insert(resetLinks)
    .values({ tokenHash: hashResetToken(token), userId, createdByUserId, expiresAt });
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
