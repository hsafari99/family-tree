import { TREE_RESTORE_DAYS } from '@family-tree/shared';
import { and, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { trees } from '../db/schema.js';
import { safeError } from '../errors.js';

/**
 * Hard-deletes trees soft-deleted more than TREE_RESTORE_DAYS ago, with everything in them
 * (FK cascades), owner or not. Returns the purged ids (phase 6 deletes their photos).
 * One instance at a time: the others get [] while the lock is held. A concurrent restore wins,
 * because the DELETE re-checks deleted_at after waiting for the row lock.
 */
export async function purgeDeletedTrees(db: Db, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - TREE_RESTORE_DAYS * 86_400_000);
  return db.transaction(async (tx) => {
    const [lock] = (await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtextextended('purge-trees', 0)) as ok`,
    )) as unknown as { ok: boolean }[];
    if (!lock?.ok) return [];
    const rows = await tx
      .delete(trees)
      .where(and(isNotNull(trees.deletedAt), lt(trees.deletedAt, cutoff)))
      .returning({ id: trees.id });
    return rows.map((r) => r.id);
  });
}

interface JobLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** Runs the purge now and then every `intervalMs`; returns a stop function. */
export function startPurgeJob(db: Db, log: JobLog, intervalMs: number): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    purgeDeletedTrees(db)
      .then((ids) => {
        if (ids.length > 0) log.info({ count: ids.length }, 'purged deleted trees');
      })
      .catch((err: unknown) => log.error({ err: safeError(err) }, 'tree purge failed'))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
