import { asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { Db, Queryable } from '../db/client.js';
import { photos, storageDeletions } from '../db/schema.js';
import { safeError } from '../errors.js';
import type { ObjectStore } from './objects.js';

interface Log {
  error(obj: object, msg: string): void;
}

/** Queues keys for deletion; call inside the transaction that drops their rows (decision 13). */
export async function queueObjectDeletes(db: Queryable, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await db
    .insert(storageDeletions)
    .values(keys.map((key) => ({ key })))
    .onConflictDoNothing();
}

/** Queues both objects of every photo matching `where`, before a cascade drops the rows. */
export async function queuePhotoObjects(db: Queryable, where: SQL): Promise<string[]> {
  const rows = (await db.execute(sql`
    insert into ${storageDeletions} (key)
    select v.key from ${photos}
      cross join lateral (values (${photos.storageKeyFull}), (${photos.storageKeyThumb})) as v(key)
      where ${where}
    on conflict do nothing
    returning key`)) as unknown as { key: string }[];
  return rows.map((r) => r.key);
}

/**
 * Deletes queued objects, oldest first (or only `keys`), and drops their rows. A failure stays
 * queued with attempts + 1, for the next run. Call after the queueing transaction committed.
 */
export async function drainStorageDeletions(
  db: Db,
  store: ObjectStore,
  { keys, limit = 500, log }: { keys?: readonly string[]; limit?: number; log?: Log } = {},
): Promise<{ deleted: number; failed: number }> {
  if (keys?.length === 0) return { deleted: 0, failed: 0 };
  const rows = await db
    .select({ key: storageDeletions.key })
    .from(storageDeletions)
    .where(keys ? inArray(storageDeletions.key, [...keys]) : undefined)
    // Backoff: fewest attempts first, then least recently tried, then oldest. A key that keeps
    // failing can't hold up the rest of the queue.
    .orderBy(
      asc(storageDeletions.attempts),
      sql`${storageDeletions.lastTriedAt} asc nulls first`,
      asc(storageDeletions.createdAt),
    )
    .limit(limit);
  let deleted = 0;
  let failed = 0;
  for (const { key } of rows) {
    try {
      await store.delete(key);
      await db.delete(storageDeletions).where(eq(storageDeletions.key, key));
      deleted++;
    } catch (err) {
      failed++;
      await db
        .update(storageDeletions)
        .set({ attempts: sql`${storageDeletions.attempts} + 1`, lastTriedAt: sql`now()` })
        .where(eq(storageDeletions.key, key));
      log?.error({ err: safeError(err) }, 'storage delete failed; queued for retry');
    }
  }
  return { deleted, failed };
}
