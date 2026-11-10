import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { addPhotoRow, objectExists } from '../../test/photo-helpers.js';
import { loadConfig } from '../config.js';
import { persons, storageDeletions, trees } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { queueObjectDeletes } from './deletions.js';
import { sweepOrphans } from './sweep.js';

const config = loadConfig();
const deps = createDeps(config);
const { db, storage } = deps;
afterAll(async () => {
  await deps.close();
});

const DAY = 86_400_000;
const LATER = () => Date.now() + 2 * DAY;
const bytes = new Uint8Array([1, 2, 3]);

/** A tree with `photos` known photos (2 objects each), `orphans` unknown objects and 1 queued. */
async function setup({ photos = 4, orphans = 1 } = {}) {
  const [tree] = await db.insert(trees).values({ name: 'Sweep test' }).returning();
  const prefix = `trees/${tree!.id}/`;
  const kept = [];
  for (let i = 0; i < photos; i++) {
    const [p] = await db
      .insert(persons)
      .values({ treeId: tree!.id, givenName: `P${i}` })
      .returning();
    const row = await addPhotoRow(db, tree!.id, p!.id);
    for (const k of [row.storageKeyFull, row.storageKeyThumb])
      await storage.put(k, bytes, 'image/webp');
    kept.push(row);
  }
  const orphanKeys = [];
  for (let i = 0; i < orphans; i++) {
    const k = `${prefix}photos/${randomUUID()}/full.webp`;
    await storage.put(k, bytes, 'image/webp');
    orphanKeys.push(k);
  }
  const queued = `${prefix}photos/${randomUUID()}/thumb.webp`;
  await storage.put(queued, bytes, 'image/webp');
  await queueObjectDeletes(db, [queued]);
  return { prefix, kept, orphanKeys, queued, total: photos * 2 + orphans + 1 };
}

describe('sweepOrphans', () => {
  it('deletes only objects older than a day that no row knows', async () => {
    const s = await setup(); // 8 known + 1 orphan + 1 queued: 10% candidates
    // Fresh objects are never orphans: an upload writes them before its row (Phase 6 decision 6).
    expect(await sweepOrphans(db, storage, { prefix: s.prefix })).toMatchObject({
      scanned: s.total,
      deleted: 0,
      refused: null,
    });
    expect(await sweepOrphans(db, storage, { prefix: s.prefix, now: LATER() })).toMatchObject({
      scanned: s.total,
      deleted: 1,
      refused: null,
    });
    expect(await objectExists(deps, s.orphanKeys[0]!)).toBe(false);
    for (const row of s.kept) {
      expect(await objectExists(deps, row.storageKeyFull)).toBe(true);
      expect(await objectExists(deps, row.storageKeyThumb)).toBe(true);
    }
    expect(await objectExists(deps, s.queued)).toBe(true); // the outbox owns it
  });

  it('refuses, deleting nothing, when candidates are over 20% of the objects scanned', async () => {
    const s = await setup({ photos: 2, orphans: 3 }); // 3 of 8 = 37.5%
    const log = { warn: vi.fn() };
    const r = await sweepOrphans(db, storage, { prefix: s.prefix, now: LATER(), log });
    expect(r).toMatchObject({ deleted: 0, refused: 'tooMany', candidates: 3 });
    for (const k of s.orphanKeys) expect(await objectExists(deps, k)).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'tooMany', candidates: 3, scanned: 8 }),
      'orphan sweep refused',
    );
  });

  it('refuses when candidates exceed the per-run cap', async () => {
    const s = await setup({ photos: 10, orphans: 2 }); // 2 of 23: under 20%
    const r = await sweepOrphans(db, storage, { prefix: s.prefix, now: LATER(), maxDeletes: 1 });
    expect(r).toMatchObject({ deleted: 0, refused: 'tooMany', candidates: 2 });
    for (const k of s.orphanKeys) expect(await objectExists(deps, k)).toBe(true);
  });

  it('refuses when the database has no photo rows but the bucket has objects', async () => {
    const s = await setup();
    const log = { warn: vi.fn() };
    // An empty photos table (as after a restore to the wrong database), inside a transaction that
    // is rolled back, so the other tests' rows come back.
    const rollback = new Error('rollback');
    let r: Awaited<ReturnType<typeof sweepOrphans>> | undefined;
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`delete from photos`);
        r = await sweepOrphans(tx, storage, { prefix: s.prefix, now: LATER(), log });
        throw rollback;
      })
      .catch((err: unknown) => {
        if (err !== rollback) throw err;
      });
    expect(r).toMatchObject({ deleted: 0, refused: 'noPhotoRows' });
    for (const row of s.kept) expect(await objectExists(deps, row.storageKeyFull)).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'noPhotoRows' }),
      'orphan sweep refused',
    );
  });

  it('warns about queued deletions that keep failing', async () => {
    const key = `trees/${randomUUID()}/photos/${randomUUID()}/full.webp`;
    await db.insert(storageDeletions).values({ key, attempts: 12 });
    const log = { warn: vi.fn() };
    try {
      const r = await sweepOrphans(db, storage, { prefix: `trees/${randomUUID()}/`, log });
      expect(r.stuck).toBeGreaterThanOrEqual(1);
      expect(log.warn).toHaveBeenCalledWith(
        { count: r.stuck },
        'stored objects keep failing to delete',
      );
    } finally {
      await db.delete(storageDeletions).where(eq(storageDeletions.key, key));
    }
  });
});
