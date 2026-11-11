import { TREE_RESTORE_DAYS } from '@family-tree/shared';
import { inArray, sql } from 'drizzle-orm';
import { purgeExpiredMoves } from '../auth/two-factor-move.js';
import type { Db } from '../db/client.js';
import { photos, trees } from '../db/schema.js';
import { safeError } from '../errors.js';
import { drainStorageDeletions, queuePhotoObjects } from '../storage/deletions.js';
import type { ObjectStore } from '../storage/objects.js';
import { sweepOrphans } from '../storage/sweep.js';

const BATCH = 50;

export interface PurgeResult {
  ids: string[];
  /** Another purge held the lock, so this call did nothing (more). */
  busy: boolean;
}

/**
 * Hard-deletes trees soft-deleted more than TREE_RESTORE_DAYS ago, with everything in them
 * (FK cascades), owner or not, in short transactions of up to 50 trees. Age is measured with
 * the database clock. Queues the purged trees' photo objects in the outbox; `drainStorageDeletions` deletes them. Returns the purged ids. One instance at a
 * time: the lock is taken per batch, and a caller that can't get it reports `busy`. A concurrent
 * restore wins, because the subselect locks the rows and re-checks deleted_at.
 */
export async function purgeDeletedTrees(db: Db): Promise<PurgeResult> {
  const ids: string[] = [];
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      const [lock] = (await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtextextended('purge-trees', 0)) as ok`,
      )) as unknown as { ok: boolean }[];
      if (!lock?.ok) return null;
      const rows = (await tx.execute(sql`
        select id from ${trees}
        where deleted_at is not null
          and deleted_at < now() - make_interval(days => ${TREE_RESTORE_DAYS})
        order by deleted_at
        limit ${BATCH}
        for update skip locked
      `)) as unknown as { id: string }[];
      const batchIds = rows.map((r) => r.id);
      if (batchIds.length === 0) return [];
      // The rows are locked, so a concurrent restore waits and then finds nothing to restore.
      // Photo objects outlive their rows: queue them before the cascade (decision 13).
      await queuePhotoObjects(tx, inArray(photos.treeId, batchIds));
      await tx.delete(trees).where(inArray(trees.id, batchIds));
      return batchIds;
    });
    if (batch === null) return { ids, busy: true };
    ids.push(...batch);
    if (batch.length < BATCH) return { ids, busy: false };
  }
}

interface JobLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
  warn?(obj: object, msg: string): void;
}

/**
 * Runs the purge now and then every `intervalMs`, also dropping expired pending 2FA moves. The returned function stops the timer and
 * resolves once any run in flight has finished.
 */
export function startPurgeJob(
  db: Db,
  log: JobLog,
  intervalMs: number,
  store?: ObjectStore,
  { sweepEveryMs = 0, now = Date.now }: { sweepEveryMs?: number; now?: () => number } = {},
): () => Promise<void> {
  let current: Promise<void> | null = null;
  // Guard 1 (review fix C1): the first sweep comes one full period after startup, never on the
  // first tick, so a crash loop or a just-restored database is never swept.
  let lastSweep = now();
  const tick = () => {
    if (current) return;
    current = purgeDeletedTrees(db)
      .then(async ({ ids }) => {
        if (ids.length > 0) log.info({ count: ids.length }, 'purged deleted trees');
        try {
          const moves = await purgeExpiredMoves(db);
          if (moves > 0) log.info({ moves }, 'removed expired 2FA moves');
        } catch (err: unknown) {
          log.error({ err: safeError(err) }, 'expired 2FA move cleanup failed');
        }
        if (!store) return;
        for (;;) {
          const { deleted, failed } = await drainStorageDeletions(db, store, { log });
          if (deleted > 0) log.info({ deleted }, 'deleted stored objects');
          if (deleted + failed < 500 || failed > 0) break; // done, or storage is down: next tick
        }
        if (sweepEveryMs > 0 && now() - lastSweep >= sweepEveryMs) {
          lastSweep = now();
          try {
            const { deleted } = await sweepOrphans(db, store, { log });
            if (deleted > 0) log.info({ deleted }, 'removed orphaned stored objects');
          } catch (err: unknown) {
            log.error({ err: safeError(err) }, 'orphan sweep failed');
          }
        }
      })
      .catch((err: unknown) => log.error({ err: safeError(err) }, 'tree purge failed'))
      .finally(() => {
        current = null;
      });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await current;
  };
}
