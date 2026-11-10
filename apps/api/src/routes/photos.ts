import { randomUUID } from 'node:crypto';
import {
  PHOTO_MEDIA_TYPES,
  PHOTO_UPLOAD_MAX_BYTES,
  PHOTOS_PER_PERSON_MAX,
  type PhotoRejectReason,
} from '@family-tree/shared';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyError, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { persons, photos } from '../db/schema.js';
import { AppError, idParam, notFound, safeError } from '../errors.js';
import {
  lockTreePhotos,
  photoBytesUsed,
  photoKeys,
  requireLivePhoto,
  toPhoto,
} from '../photos/photos.js';
import { LimiterFull, limiter } from '../photos/limiter.js';
import { PhotoRejected, processPhoto } from '../photos/process.js';
import { extraLimit } from '../security/limits.js';
import { drainStorageDeletions, queueObjectDeletes } from '../storage/deletions.js';
import { type Access, authorize, loadAccess } from '../trees/access.js';
import { audit } from '../trees/audit.js';
import { lockTreeGraph } from '../trees/graph.js';
import { isLivePerson, requireLivePerson } from '../trees/people.js';
import type { TreeRouteOptions } from './trees.js';

const UPLOAD_URL = '/api/v1/trees/:treeId/persons/:personId/photos';

/** At most two photos decode at once per process, and eight wait (decision 3). */
export const PHOTO_JOBS_WAITING_MAX = 8;
const busy = () =>
  new AppError('RATE_LIMITED', 503, 'Too many photos are being processed, try again shortly');

export const photoRejected = (reason: PhotoRejectReason) =>
  new AppError('VALIDATION', 400, 'The photo was not accepted', { reason });
const quotaFull = (limitBytes: number) =>
  new AppError('QUOTA_EXCEEDED', 403, 'This tree has used its photo storage', { limitBytes });

export const photosRoutes: FastifyPluginAsync<
  TreeRouteOptions & { photoJobs?: ReturnType<typeof limiter> }
> = async (app, { auth, db, config, storage, photoJobs = limiter(2, PHOTO_JOBS_WAITING_MAX) }) => {
  // onRequest, not preHandler: the upload route decides who may send a body before it is read.
  app.addHook('onRequest', requireSession(auth));

  // Image bytes are the request body (decision 2). Only this plugin's routes accept these types.
  app.addContentTypeParser(
    [...PHOTO_MEDIA_TYPES],
    { parseAs: 'buffer', bodyLimit: PHOTO_UPLOAD_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  // Decision 15, upload route only: a body over the limit, or a Content-Type no parser accepts,
  // becomes the photo error shape. Everything else keeps the app's handler and its shape.
  const appHandler = app.errorHandler;
  app.setErrorHandler(function (err: FastifyError, req, reply) {
    const reason =
      err.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? 'tooLarge'
        : err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
          ? 'type'
          : null;
    if (reason !== null && req.routeOptions.url === UPLOAD_URL) {
      return reply.code(err.statusCode ?? 400).send({
        error: { code: 'VALIDATION', message: 'The photo was not accepted', details: { reason } },
      });
    }
    return appHandler.call(this, err, req, reply);
  });

  /** Removes objects of a failed upload now, or queues them if storage refuses. */
  async function discard(keys: string[], log: FastifyRequest['log']) {
    for (const key of keys) {
      try {
        await storage.delete(key);
      } catch {
        await queueObjectDeletes(db, [key]);
        log.warn('upload cleanup queued an object for later deletion');
      }
    }
  }

  const uploads = new WeakMap<FastifyRequest, { access: Access; personId: string }>();

  app.post(
    UPLOAD_URL,
    {
      bodyLimit: PHOTO_UPLOAD_MAX_BYTES,
      // Who may upload is settled before the body is read: outsiders and viewers are never
      // buffered (decision 2). Runs after the plugin's session hook.
      onRequest: [
        extraLimit(app, { name: 'photo-upload', max: 30, timeWindow: '10 minutes', by: 'user' }),
        async (req) => {
          const access = await loadAccess(db, idParam(req.params, 'treeId'), req.user!.id);
          const person = await requireLivePerson(
            db,
            access.treeId,
            idParam(req.params, 'personId'),
          );
          authorize(access, 'person.edit', { kind: 'person', personId: person.id });
          uploads.set(req, { access, personId: person.id });
        },
      ],
    },
    async (req, reply) => {
      const { access, personId } = uploads.get(req)!;
      const { treeId } = access;
      if (!Buffer.isBuffer(req.body)) throw photoRejected('type');
      const limitBytes = config.MAX_PHOTO_BYTES_PER_TREE;
      if ((await photoBytesUsed(db, treeId)) >= limitBytes) throw quotaFull(limitBytes);

      let processed;
      try {
        processed = await photoJobs(() => processPhoto(req.body as Buffer));
      } catch (err) {
        if (err instanceof LimiterFull) {
          void reply.header('retry-after', '5');
          throw busy();
        }
        if (err instanceof PhotoRejected) throw photoRejected(err.reason);
        throw err;
      }
      const id = randomUUID();
      const keys = photoKeys(treeId, id);
      const bytes = processed.full.length + processed.thumb.length;
      const { width, height } = processed;

      await storage.put(keys.thumb, processed.thumb, 'image/webp');
      let committed: { row: typeof photos.$inferSelect; used: number };
      try {
        await storage.put(keys.full, processed.full, 'image/webp');
        committed = await db.transaction(async (tx) => {
          // Lock order: the tree graph, then photos. The access read in onRequest may be stale
          // by now, so it is loaded again under the lock.
          await lockTreeGraph(tx, treeId);
          await lockTreePhotos(tx, treeId);
          const fresh = await loadAccess(tx, treeId, req.user!.id);
          const [live] = await tx
            .select({ id: persons.id })
            .from(persons)
            .where(isLivePerson(treeId, personId))
            .for('update');
          if (!live) throw notFound();
          authorize(fresh, 'person.edit', { kind: 'person', personId });
          const used = await photoBytesUsed(tx, treeId);
          if (used + bytes > limitBytes) throw quotaFull(limitBytes);
          const [stats] = await tx
            .select({
              n: count(),
              primaries: sql<number>`(count(*) filter (where ${photos.isPrimary}))::int`,
            })
            .from(photos)
            .where(eq(photos.personId, personId));
          if ((stats?.n ?? 0) >= PHOTOS_PER_PERSON_MAX) throw photoRejected('tooMany');
          const [row] = await tx
            .insert(photos)
            .values({
              id,
              treeId,
              personId,
              storageKeyFull: keys.full,
              storageKeyThumb: keys.thumb,
              width,
              height,
              bytes,
              isPrimary: (stats?.primaries ?? 0) === 0,
              uploadedBy: req.user!.id,
            })
            .returning();
          await audit(tx, access, {
            action: 'photo.create',
            entityType: 'photo',
            entityId: id,
            personIds: [personId],
            after: { width, height, bytes },
          });
          return { row: row!, used: used + bytes };
        });
      } catch (err) {
        await discard([keys.thumb, keys.full], req.log);
        throw err;
      }
      // After the commit: a failure here must not delete the objects of a photo that now exists.
      const { row, used } = committed;
      const photo = await toPhoto(storage, { ...row, uploadedByName: req.user!.name });
      return reply.code(201).send({ photo, usage: { usedBytes: used, limitBytes } });
    },
  );

  app.post('/api/v1/trees/:treeId/photos/:photoId/primary', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    const photoId = idParam(req.params, 'photoId');
    await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      await lockTreePhotos(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const p = await requireLivePhoto(tx, access.treeId, photoId);
      authorize(access, 'person.edit', { kind: 'person', personId: p.personId });
      if (p.isPrimary) return;
      await tx
        .update(photos)
        .set({ isPrimary: false })
        .where(and(eq(photos.personId, p.personId), eq(photos.isPrimary, true)));
      await tx.update(photos).set({ isPrimary: true }).where(eq(photos.id, p.id));
      await audit(tx, access, {
        action: 'photo.primary',
        entityType: 'photo',
        entityId: p.id,
        personIds: [p.personId],
      });
    });
    return reply.code(204).send();
  });

  app.delete('/api/v1/trees/:treeId/photos/:photoId', async (req, reply) => {
    const treeId = idParam(req.params, 'treeId');
    const photoId = idParam(req.params, 'photoId');
    const keys = await db.transaction(async (tx) => {
      await lockTreeGraph(tx, treeId);
      await lockTreePhotos(tx, treeId);
      const access = await loadAccess(tx, treeId, req.user!.id);
      const p = await requireLivePhoto(tx, access.treeId, photoId);
      authorize(access, 'person.edit', { kind: 'person', personId: p.personId });
      await tx.delete(photos).where(eq(photos.id, p.id));
      if (p.isPrimary) {
        const [next] = await tx
          .select({ id: photos.id })
          .from(photos)
          .where(eq(photos.personId, p.personId))
          .orderBy(desc(photos.createdAt))
          .limit(1);
        if (next) await tx.update(photos).set({ isPrimary: true }).where(eq(photos.id, next.id));
      }
      const gone = [p.storageKeyFull, p.storageKeyThumb];
      await queueObjectDeletes(tx, gone);
      await audit(tx, access, {
        action: 'photo.delete',
        entityType: 'photo',
        entityId: p.id,
        personIds: [p.personId],
        before: { width: p.width, height: p.height, bytes: p.bytes },
      });
      return gone;
    });
    // The delete is committed: a failing drain leaves the keys queued for the purge job.
    try {
      await drainStorageDeletions(db, storage, { keys, log: req.log });
    } catch (err) {
      req.log.error({ err: safeError(err) }, 'storage drain failed; keys stay queued');
    }
    return reply.code(204).send();
  });
};
