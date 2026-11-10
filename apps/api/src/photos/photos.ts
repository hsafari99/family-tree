import { type Photo, type PhotoUsage } from '@family-tree/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Queryable, Tx } from '../db/client.js';
import { persons, photos, users } from '../db/schema.js';
import { notFound } from '../errors.js';
import type { ObjectStore } from '../storage/objects.js';

export type PhotoRow = typeof photos.$inferSelect;

/** Storage keys (decision 6): only uuids, never names. */
export const photoKeys = (treeId: string, photoId: string) => ({
  full: `trees/${treeId}/photos/${photoId}/full.webp`,
  thumb: `trees/${treeId}/photos/${photoId}/thumb.webp`,
});

/** Serialises every photo write of a tree: quota, primary and the per-person cap (decision 14). */
export const lockTreePhotos = (tx: Tx, treeId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`photos:${treeId}`}, 0))`);

/** Stored bytes of every photo row of the tree, including people in Trash (decision 14). */
export async function photoBytesUsed(db: Queryable, treeId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<string>`coalesce(sum(${photos.bytes}), 0)::bigint` })
    .from(photos)
    .where(eq(photos.treeId, treeId));
  return Number(r?.n ?? 0);
}

export const photoUsage = async (
  db: Queryable,
  treeId: string,
  limitBytes: number,
): Promise<PhotoUsage> => ({
  usedBytes: await photoBytesUsed(db, treeId),
  limitBytes,
});

/** A photo of a live person of this tree, or 404. */
export async function requireLivePhoto(db: Queryable, treeId: string, photoId: string) {
  const [row] = await db
    .select({ p: photos })
    .from(photos)
    .innerJoin(persons, and(eq(persons.id, photos.personId), isNull(persons.deletedAt)))
    .where(and(eq(photos.treeId, treeId), eq(photos.id, photoId)));
  if (!row) throw notFound();
  return row.p;
}

export async function toPhoto(
  store: ObjectStore,
  r: PhotoRow & { uploadedByName: string | null },
): Promise<Photo> {
  const [thumbUrl, fullUrl] = await Promise.all([
    store.signedUrl(r.storageKeyThumb),
    store.signedUrl(r.storageKeyFull),
  ]);
  return {
    id: r.id,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    isPrimary: r.isPrimary,
    createdAt: r.createdAt.toISOString(),
    uploadedByName: r.uploadedByName,
    thumbUrl,
    fullUrl,
  };
}

/** A person's photos for the panel: primary first, then newest. The caller checked the person is live. */
export async function loadPhotos(
  db: Queryable,
  store: ObjectStore,
  treeId: string,
  personId: string,
) {
  const rows = await db
    .select({ p: photos, uploadedByName: users.name })
    .from(photos)
    .leftJoin(users, eq(users.id, photos.uploadedBy))
    .where(and(eq(photos.treeId, treeId), eq(photos.personId, personId)))
    .orderBy(desc(photos.isPrimary), desc(photos.createdAt));
  return Promise.all(rows.map((r) => toPhoto(store, { ...r.p, uploadedByName: r.uploadedByName })));
}

/** Signed thumbnail URLs for keys (null stays null), in order. */
export const signThumbs = (store: ObjectStore, keys: readonly (string | null)[]) =>
  Promise.all(keys.map((k) => (k === null ? null : store.signedUrl(k))));
