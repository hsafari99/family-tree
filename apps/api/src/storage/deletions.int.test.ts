import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { addPhotoRow, objectExists } from '../../test/photo-helpers.js';
import { addPerson } from '../../test/tree-helpers.js';
import { loadConfig } from '../config.js';
import { photos, storageDeletions, trees } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { drainStorageDeletions, queueObjectDeletes, queuePhotoObjects } from './deletions.js';

const deps = createDeps(loadConfig());
const { db, storage } = deps;
const treeIds: string[] = [];
const prefixes: string[] = [];

afterEach(async () => {
  for (const p of prefixes.splice(0)) {
    await db.delete(storageDeletions).where(like(storageDeletions.key, `${p}%`));
  }
  const t = treeIds.splice(0);
  if (t.length > 0) await db.delete(trees).where(inArray(trees.id, t));
});
afterAll(() => deps.close());

const prefix = () => {
  const p = `test/${randomUUID()}/`;
  prefixes.push(p);
  return p;
};
const bytes = new Uint8Array([1, 2, 3]);
const outbox = (key: string) =>
  db.select().from(storageDeletions).where(eq(storageDeletions.key, key));

describe('drainStorageDeletions', () => {
  it('deletes queued objects and drops their rows', async () => {
    const p = prefix();
    const keys = [`${p}a`, `${p}b`];
    for (const k of keys) await storage.put(k, bytes, 'image/webp');
    await queueObjectDeletes(db, keys);
    expect(await drainStorageDeletions(db, storage, { keys })).toEqual({ deleted: 2, failed: 0 });
    for (const k of keys) {
      expect(await objectExists(deps, k)).toBe(false);
      expect(await outbox(k)).toHaveLength(0);
    }
  });

  it('keeps a failed key for the next run', async () => {
    const p = prefix();
    const key = `${p}a`;
    await storage.put(key, bytes, 'image/webp');
    await queueObjectDeletes(db, [key]);
    const down = { ...storage, delete: () => Promise.reject(new Error('down')) };
    const log = { error: vi.fn() };
    expect(await drainStorageDeletions(db, down, { keys: [key], log })).toEqual({
      deleted: 0,
      failed: 1,
    });
    const [row] = await outbox(key);
    expect(row!.attempts).toBe(1);
    expect(row!.lastTriedAt).not.toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(await drainStorageDeletions(db, storage, { keys: [key] })).toEqual({
      deleted: 1,
      failed: 0,
    });
    expect(await outbox(key)).toHaveLength(0);
  });

  it('queuePhotoObjects returns the four keys once', async () => {
    const [t] = await db.insert(trees).values({ name: 'del-test' }).returning();
    treeIds.push(t!.id);
    const person = await addPerson(db, t!.id, 'P');
    const a = await addPhotoRow(db, t!.id, person.id, true);
    const b = await addPhotoRow(db, t!.id, person.id, false);
    const want = [a.storageKeyFull, a.storageKeyThumb, b.storageKeyFull, b.storageKeyThumb].sort();
    prefixes.push(`trees/${t!.id}/`);
    expect((await queuePhotoObjects(db, eq(photos.personId, person.id))).sort()).toEqual(want);
    expect(await queuePhotoObjects(db, eq(photos.personId, person.id))).toEqual([]);
  });

  it('respects the limit and drains fewest attempts first', async () => {
    const p = prefix();
    const old = `${p}old`;
    const fresh = `${p}fresh`;
    await db.insert(storageDeletions).values({ key: old, attempts: 5 });
    await db.insert(storageDeletions).values({ key: fresh });
    const seen: string[] = [];
    const spy = { ...storage, delete: (k: string) => (seen.push(k), Promise.resolve()) };
    const keys = [old, fresh];
    expect(await drainStorageDeletions(db, spy, { keys, limit: 1 })).toEqual({
      deleted: 1,
      failed: 0,
    });
    expect(seen).toEqual([fresh]);
    await drainStorageDeletions(db, spy, { keys });
    expect(seen).toEqual([fresh, old]);
  });
});
