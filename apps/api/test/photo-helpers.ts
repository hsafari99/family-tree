import { HeadObjectCommand } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.js';
import { photos } from '../src/db/schema.js';
import type { Deps } from '../src/deps.js';
import { type CookieJar, WEB_ORIGIN } from './auth-helpers.js';

/** Uploads raw image bytes the way the web app does. */
export function upload(
  app: FastifyInstance,
  url: string,
  jar: CookieJar | undefined,
  body: Buffer,
  type = 'image/jpeg',
) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin: WEB_ORIGIN, 'content-type': type, ...(jar ? { cookie: jar.header() } : {}) },
    payload: body,
  });
}

/** A photo row without objects (for isolation and search tests). */
export async function addPhotoRow(db: Db, treeId: string, personId: string, isPrimary = true) {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(photos)
    .values({
      id,
      treeId,
      personId,
      storageKeyFull: `trees/${treeId}/photos/${id}/full.webp`,
      storageKeyThumb: `trees/${treeId}/photos/${id}/thumb.webp`,
      width: 10,
      height: 10,
      bytes: 100,
      isPrimary,
    })
    .returning();
  return row!;
}

export async function objectExists(deps: Deps, key: string): Promise<boolean> {
  try {
    await deps.s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    return true;
  } catch {
    return false;
  }
}
