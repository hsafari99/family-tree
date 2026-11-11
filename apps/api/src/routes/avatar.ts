import { randomUUID } from 'node:crypto';
import {
  AVATAR_UPLOAD_MAX_BYTES,
  type AvatarResponse,
  PHOTO_MEDIA_TYPES,
} from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import type { FastifyError, FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Auth } from '../auth/auth.js';
import { requireSession } from '../auth/session-guard.js';
import type { Db, Queryable } from '../db/client.js';
import { users } from '../db/schema.js';
import { AppError, safeError } from '../errors.js';
import { LimiterFull, limiter } from '../photos/limiter.js';
import { PhotoRejected, processPhoto } from '../photos/process.js';
import { extraLimit } from '../security/limits.js';
import { drainStorageDeletions, queueObjectDeletes } from '../storage/deletions.js';
import type { ObjectStore } from '../storage/objects.js';
import { photoRejected } from './photos.js';

export const AVATAR_URL = '/api/v1/account/avatar';

/** Storage key of a profile picture (decision 6: only uuids, never names). */
export const avatarKey = (userId: string, id: string) => `users/${userId}/avatar/${id}.webp`;

/** The signed URL of a user's profile picture, or null when they have none. */
export async function avatarUrlOf(db: Queryable, store: ObjectStore, userId: string) {
  const [row] = await db.select({ key: users.avatarKey }).from(users).where(eq(users.id, userId));
  return row?.key ? store.signedUrl(row.key) : null;
}

const busy = () =>
  new AppError('RATE_LIMITED', 503, 'Too many photos are being processed, try again shortly');

/**
 * The signed-in user's own profile picture: upload (or replace) and remove. There is no user id
 * in the URL, so nobody can reach anyone else's picture. The upload goes through the photo
 * pipeline: magic bytes, the pixel guards, re-encoded as a metadata-free WebP square.
 */
export const avatarRoutes: FastifyPluginAsync<{
  auth: Auth;
  db: Db;
  storage: ObjectStore;
  avatarJobs?: ReturnType<typeof limiter>;
}> = async (app, { auth, db, storage, avatarJobs = limiter(2, 8) }) => {
  // onRequest: no body is read before the session is checked.
  app.addHook('onRequest', requireSession(auth));

  app.addContentTypeParser(
    [...PHOTO_MEDIA_TYPES],
    { parseAs: 'buffer', bodyLimit: AVATAR_UPLOAD_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  // Too large, or a type no parser accepts: the photo error shape, as for tree photos.
  const appHandler = app.errorHandler;
  app.setErrorHandler(function (err: FastifyError, req, reply) {
    const reason =
      err.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? 'tooLarge'
        : err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
          ? 'type'
          : null;
    if (reason !== null && req.routeOptions.url === AVATAR_URL) {
      return reply.code(err.statusCode ?? 400).send({
        error: { code: 'VALIDATION', message: 'The photo was not accepted', details: { reason } },
      });
    }
    return appHandler.call(this, err, req, reply);
  });

  /** Deletes the replaced or removed object now; the outbox keeps it if storage refuses. */
  async function drain(keys: string[], log: FastifyRequest['log']) {
    try {
      await drainStorageDeletions(db, storage, { keys, log });
    } catch (err) {
      log.error({ err: safeError(err) }, 'storage drain failed; keys stay queued');
    }
  }

  const limit = extraLimit(app, { name: 'avatar', max: 20, timeWindow: '10 minutes', by: 'user' });

  app.put(
    AVATAR_URL,
    { bodyLimit: AVATAR_UPLOAD_MAX_BYTES, onRequest: [limit] },
    async (req, reply) => {
      const userId = req.user!.id;
      if (!Buffer.isBuffer(req.body)) throw photoRejected('type');
      let processed;
      try {
        processed = await avatarJobs(() => processPhoto(req.body as Buffer));
      } catch (err) {
        if (err instanceof LimiterFull) {
          void reply.header('retry-after', '5');
          throw busy();
        }
        if (err instanceof PhotoRejected) throw photoRejected(err.reason);
        throw err;
      }
      const key = avatarKey(userId, randomUUID());
      await storage.put(key, processed.thumb, 'image/webp');
      let old: string | null;
      try {
        old = await db.transaction(async (tx) => {
          const [row] = await tx
            .select({ key: users.avatarKey })
            .from(users)
            .where(eq(users.id, userId))
            .for('update');
          if (!row) throw new AppError('NOT_FOUND', 404, 'Not found');
          await tx.update(users).set({ avatarKey: key }).where(eq(users.id, userId));
          if (row.key) await queueObjectDeletes(tx, [row.key]);
          return row.key;
        });
      } catch (err) {
        await queueObjectDeletes(db, [key]);
        await drain([key], req.log);
        throw err;
      }
      req.log.info({ event: 'avatar_updated', userId, replaced: old !== null }, 'avatar updated');
      if (old) await drain([old], req.log);
      const body: AvatarResponse = { avatarUrl: await storage.signedUrl(key) };
      return reply.code(200).send(body);
    },
  );

  app.delete(AVATAR_URL, { onRequest: [limit] }, async (req, reply) => {
    const userId = req.user!.id;
    const old = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ key: users.avatarKey })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!row?.key) return null;
      await tx.update(users).set({ avatarKey: null }).where(eq(users.id, userId));
      await queueObjectDeletes(tx, [row.key]);
      return row.key;
    });
    if (old) {
      req.log.info({ event: 'avatar_removed', userId }, 'avatar removed');
      await drain([old], req.log);
    }
    return reply.code(204).send();
  });
};
