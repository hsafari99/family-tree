import { TREE_RESTORE_DAYS } from '@family-tree/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { trees } from '../db/schema.js';
import { safeError } from '../errors.js';

const BATCH = 50;

export interface PurgeResult {
  ids: string[];
  /** Another purge held the lock, so this call did nothing (more). */
  busy: boolean;
}

/**
 * Hard-deletes trees soft-deleted more than TREE_RESTORE_DAYS ago, with everything in them
 * (FK cascades), owner or not, in short transactions of up to 50 trees. Age is measured with
 * the database clock. Returns the purged ids (phase 6 deletes their photos). One instance at a
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
        delete from ${trees} where id in (
          select id from ${trees}
          where deleted_at is not null
            and deleted_at < now() - make_interval(days => ${TREE_RESTORE_DAYS})
          order by deleted_at
          limit ${BATCH}
          for update skip locked
        ) returning id
      `)) as unknown as { id: string }[];
      return rows.map((r) => r.id);
    });
    if (batch === null) return { ids, busy: true };
    ids.push(...batch);
    if (batch.length < BATCH) return { ids, busy: false };
  }
}

interface JobLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/**
 * Runs the purge now and then every `intervalMs`. The returned function stops the timer and
 * resolves once any run in flight has finished.
 */
export function startPurgeJob(db: Db, log: JobLog, intervalMs: number): () => Promise<void> {
  let current: Promise<void> | null = null;
  const tick = () => {
    if (current) return;
    current = purgeDeletedTrees(db)
      .then(({ ids }) => {
        if (ids.length > 0) log.info({ count: ids.length }, 'purged deleted trees');
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
