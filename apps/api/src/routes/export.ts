import { EXPORT_MAX_PHOTO_BYTES } from '@family-tree/shared';
import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/session-guard.js';
import { AppError, idParam, safeError } from '../errors.js';
import { loadExport } from '../export/load.js';
import { exportFileName, writeExport } from '../export/write.js';
import { ZipAborted, ZipWriter } from '../export/zip.js';
import { TREE } from '../permissions/can.js';
import { extraLimit } from '../security/limits.js';
import { authorize, loadAccess } from '../trees/access.js';
import type { TreeRouteOptions } from './trees.js';

/** Exports streaming at once in one API process, and per user (decision 8). */
export const EXPORT_CONCURRENCY = 2;
/** Wall-clock limit per export: frees the slot even if storage hangs (review fix I6). */
export const EXPORT_TIMEOUT_MS = 10 * 60_000;

const busy = () => new AppError('RATE_LIMITED', 503, 'Exports are busy, try again in a minute');
const tooLarge = () =>
  new AppError('VALIDATION', 400, 'This tree is too large to export as one file', {
    reason: 'tooLarge',
  });

export const exportRoutes: FastifyPluginAsync<
  TreeRouteOptions & { exportConcurrency?: number; exportTimeoutMs?: number }
> = async (
  app,
  {
    auth,
    db,
    storage,
    exportConcurrency = EXPORT_CONCURRENCY,
    exportTimeoutMs = EXPORT_TIMEOUT_MS,
  },
) => {
  app.addHook('preHandler', requireSession(auth));
  let active = 0;
  /** Users with an export running: one each. */
  const exporting = new Set<string>();
  /**
   * One-time tickets from the preflight (?check=1): the browser downloads by navigating, so it
   * can't show an error from the download itself. The preflight does the access, busy, size and
   * rate-limit checks and counts once; its ticket lets the download skip the rate limit.
   */
  const tickets = new Map<string, { userId: string; treeId: string; expires: number }>();
  const TICKET_TTL_MS = 60_000;
  const exportLimit = extraLimit(app, { name: 'export', max: 5, timeWindow: '1 hour', by: 'user' });
  const takeTicket = (req: FastifyRequest): boolean => {
    const { ticket } = req.query as { ticket?: unknown };
    if (typeof ticket !== 'string') return false;
    const t = tickets.get(ticket);
    if (!t) return false;
    tickets.delete(ticket);
    const { treeId } = req.params as { treeId?: string };
    return t.expires > Date.now() && t.userId === req.user?.id && t.treeId === treeId;
  };

  /** Spec §7: one ZIP with tree.ged (GEDCOM 5.5.1), tree.json and photos/ (decisions 2–8). */
  app.get(
    '/api/v1/trees/:treeId/export',
    {
      preHandler: async (req) => {
        if (!takeTicket(req)) await exportLimit(req);
      },
    },
    async (req, reply) => {
      const treeId = idParam(req.params, 'treeId');
      const userId = req.user!.id;
      const now = new Date();
      const check = (req.query as { check?: unknown }).check === '1';
      let held = false;
      const release = () => {
        if (held) {
          held = false;
          active--;
          exporting.delete(userId);
        }
      };
      try {
        const loaded = await db.transaction(
          async (tx) => {
            const access = await loadAccess(tx, treeId, userId);
            authorize(access, 'tree.export', TREE);
            if (active >= exportConcurrency || exporting.has(userId)) {
              void reply.header('retry-after', '30');
              throw busy();
            }
            if (!check) {
              active++;
              exporting.add(userId);
              held = true;
            }
            return loadExport(tx, access.treeId, now);
          },
          { isolationLevel: 'repeatable read', accessMode: 'read only' },
        );
        if (loaded.photoBytes > EXPORT_MAX_PHOTO_BYTES) throw tooLarge();
        if (check) {
          const now = Date.now();
          for (const [k, t] of tickets) if (t.expires <= now) tickets.delete(k);
          const ticket = randomBytes(24).toString('base64url');
          tickets.set(ticket, { userId, treeId, expires: now + TICKET_TTL_MS });
          return reply.header('cache-control', 'no-store').send({ ticket });
        }

        const zip = new ZipWriter(now);
        // Aborts a pending storage read when the export ends for any reason (review fix I2).
        const abort = new AbortController();
        const timer = setTimeout(() => {
          req.log.warn({ treeId }, 'export timed out');
          zip.abort(new Error('export timed out'));
        }, exportTimeoutMs);
        zip.stream.once('close', () => {
          clearTimeout(timer);
          abort.abort();
          release();
        });
        void writeExport(zip, loaded, storage, {
          exporterName: req.user!.name,
          now,
          signal: abort.signal,
        })
          .then(({ photos, missing }) =>
            req.log.info(
              { treeId, persons: loaded.data.persons.length, photos, missing },
              'tree exported',
            ),
          )
          .catch((err: unknown) => {
            if (err instanceof ZipAborted || abort.signal.aborted)
              req.log.info({ treeId }, 'export stopped: client left');
            else req.log.error({ err: safeError(err), treeId }, 'export failed');
            abort.abort();
            zip.abort(new Error('export failed'));
          })
          .finally(release);
        return reply
          .header('content-type', 'application/zip')
          .header('content-disposition', `attachment; filename="${exportFileName(now)}"`)
          .header('cache-control', 'no-store')
          .send(zip.stream);
      } catch (err) {
        release();
        throw err;
      }
    },
  );
};
