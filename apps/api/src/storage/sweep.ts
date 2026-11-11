import { sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import type { ObjectStore } from './objects.js';

/** Younger objects may belong to an upload whose row isn't committed yet (decision 17). */
export const ORPHAN_MIN_AGE_MS = 24 * 3_600_000;
/** Outbox rows with this many failed attempts are reported. */
export const STUCK_ATTEMPTS = 10;
/** Guards (review fix C1): never delete more than this share of what was scanned... */
export const ORPHAN_MAX_FRACTION = 0.2;
/** ...or more than this many objects in one run. */
export const ORPHAN_MAX_DELETES = 500;

export type SweepRefusal = 'noPhotoRows' | 'tooMany';

/**
 * Deletes stored objects under `prefix` that are older than `minAgeMs` and known to no photos
 * row, no user's avatar and no storage_deletions row (the outbox deletes those itself). This covers a crash between
 * upload and insert, and a database restored to before some uploads.
 *
 * Candidates are collected first. Nothing is deleted when the database has no photo rows at all
 * while the bucket has objects, or when the candidates are over ORPHAN_MAX_FRACTION of the scan
 * or over `maxDeletes`: those look like a wrong or empty database, not like orphans.
 * Also reports stuck outbox rows.
 */
export async function sweepOrphans(
  db: Queryable,
  store: ObjectStore,
  {
    prefix = 'trees/',
    now = Date.now(),
    minAgeMs = ORPHAN_MIN_AGE_MS,
    maxDeletes = ORPHAN_MAX_DELETES,
    log,
  }: {
    prefix?: string;
    now?: number;
    minAgeMs?: number;
    maxDeletes?: number;
    log?: { warn?(obj: object, msg: string): void };
  } = {},
): Promise<{
  scanned: number;
  candidates: number;
  deleted: number;
  stuck: number;
  refused: SweepRefusal | null;
}> {
  const [counted] = (await db.execute(sql`select count(*)::int as n from photos`)) as unknown as {
    n: number;
  }[];
  const photoRows = counted?.n ?? 0;
  const known = new Set(
    (
      (await db.execute(sql`
        select storage_key_full as k from photos
        union all select storage_key_thumb from photos
        union all select key from storage_deletions
        union all select avatar_key from users where avatar_key is not null`)) as unknown as {
        k: string;
      }[]
    ).map((r) => r.k),
  );
  let scanned = 0;
  const candidates: string[] = [];
  for await (const o of store.list(prefix)) {
    scanned++;
    if (!known.has(o.key) && now - o.lastModified.getTime() >= minAgeMs) candidates.push(o.key);
  }

  let refused: SweepRefusal | null = null;
  if (photoRows === 0 && scanned > 0) refused = 'noPhotoRows';
  else if (candidates.length > maxDeletes || candidates.length > scanned * ORPHAN_MAX_FRACTION) {
    refused = 'tooMany';
  }
  let deleted = 0;
  if (refused) {
    log?.warn?.(
      { reason: refused, scanned, candidates: candidates.length, photoRows },
      'orphan sweep refused',
    );
  } else {
    for (const key of candidates) {
      await store.delete(key);
      deleted++;
    }
  }

  const [row] = (await db.execute(
    sql`select count(*)::int as n from storage_deletions where attempts >= ${STUCK_ATTEMPTS}`,
  )) as unknown as { n: number }[];
  const stuck = row?.n ?? 0;
  if (stuck > 0) log?.warn?.({ count: stuck }, 'stored objects keep failing to delete');
  return { scanned, candidates: candidates.length, deleted, stuck, refused };
}
