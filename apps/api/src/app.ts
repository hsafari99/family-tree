import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { ApiError } from '@family-tree/shared';
import Fastify, { type FastifyError } from 'fastify';
import type { Auth } from './auth/auth.js';
import { authRoutes } from './auth/fastify-adapter.js';
import type { Config } from './config.js';
import { AppError, safeError } from './errors.js';
import { healthRoutes, type HealthChecks } from './routes/health.js';
import { invitesRoutes } from './routes/invites.js';
import { membersRoutes } from './routes/members.js';
import { stewardsRoutes } from './routes/stewards.js';
import { meRoutes } from './routes/me.js';
import { personsRoutes } from './routes/persons.js';
import { relationsRoutes } from './routes/relations.js';
import { residencesRoutes } from './routes/residences.js';
import { photosRoutes } from './routes/photos.js';
import { trashRoutes } from './routes/trash.js';
import type { limiter } from './photos/limiter.js';
import { graphRoutes } from './routes/graph.js';
import { deletionRoutes } from './routes/deletion.js';
import { passwordResetRoutes } from './routes/password-reset.js';
import { treesRoutes } from './routes/trees.js';
import type { Db } from './db/client.js';
import { createObjectStore, type ObjectStore } from './storage/objects.js';
import { originGuard } from './security/origin-guard.js';

/** Mounts /api/auth/* and the session and reset routes. Optional so unit tests skip the database. */
type AuthOptions =
  | { auth?: undefined; db?: undefined; storage?: undefined }
  | { auth: Auth; db: Db; storage?: ObjectStore };

export type AppOptions = AuthOptions & {
  config: Config;
  checks: HealthChecks;
  /** Global per-IP requests per minute (default 300). Routes may set their own limit. */
  rateLimitMax?: number;
  /** Where log lines go (default stdout). Tests pass a stream to inspect them. */
  logStream?: { write(line: string): void };
  /** Photo processing slots; tests inject a full one to check the busy answer. */
  photoJobs?: ReturnType<typeof limiter>;
};

/**
 * Trust exactly `hops` proxies counted from the socket peer, so req.ip is the address the
 * outermost trusted proxy saw. Never `true`: that takes the leftmost X-Forwarded-For entry,
 * which the client controls. A function because Fastify 5.12 treats a numeric trustProxy as
 * "trust nothing". Only safe when the API is reachable solely through those proxies.
 */
function trustHops(hops: number) {
  return hops > 0 ? (_address: string, hop: number) => hop < hops : false;
}

export function buildApp({
  config,
  checks,
  auth,
  db,
  storage,
  rateLimitMax = 300,
  logStream,
  photoJobs,
}: AppOptions) {
  const app = Fastify({
    trustProxy: trustHops(config.TRUST_PROXY),
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            // No handler logs request bodies; this is a backstop for anything that does.
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              '*.password',
            ],
            ...(logStream ? { stream: logStream } : {}),
          },
  });

  app.register(helmet);
  app.register(cors, {
    origin: [config.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  });
  // Every route must be registered inside a plugin (app.register) after this line; routes added
  // directly on `app`, or before this plugin, are not rate-limited.
  app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: '1 minute',
    errorResponseBuilder: () =>
      new AppError('RATE_LIMITED', 429, 'Too many requests, try again later'),
  });
  app.addHook('onRequest', originGuard(config.WEB_ORIGIN));
  app.register(healthRoutes, { checks });
  // Tests that don't care about storage get a real store from the config (no network until used).
  const store = auth ? (storage ?? createObjectStore(config)) : undefined;
  if (auth && !storage) app.addHook('onClose', async () => store!.close());
  if (auth) {
    app.register(authRoutes, { auth });
    app.register(meRoutes, { auth, db });
    app.register(passwordResetRoutes, { auth, db });
    app.register(treesRoutes, { auth, db, config, storage: store! });
    app.register(membersRoutes, { auth, db, config, storage: store! });
    app.register(stewardsRoutes, { auth, db, config, storage: store! });
    app.register(invitesRoutes, { auth, db, config, storage: store! });
    app.register(personsRoutes, { auth, db, config, storage: store! });
    app.register(relationsRoutes, { auth, db, config, storage: store! });
    app.register(residencesRoutes, { auth, db, config, storage: store! });
    app.register(photosRoutes, {
      auth,
      db,
      config,
      storage: store!,
      ...(photoJobs ? { photoJobs } : {}),
    });
    app.register(deletionRoutes, { auth, db, config, storage: store! });
    app.register(trashRoutes, { auth, db, config, storage: store! });
    app.register(graphRoutes, { auth, db, config, storage: store! });
  }

  app.setNotFoundHandler((_req, reply) => {
    const body: ApiError = { error: { code: 'NOT_FOUND', message: 'Not found' } };
    return reply.code(404).send(body);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const send = (status: number, error: ApiError['error']) => {
      const body: ApiError = { error };
      return reply.code(status).send(body);
    };
    if (err instanceof AppError) {
      if (err.statusCode >= 500) req.log.error({ err: safeError(err) });
      return send(err.statusCode, {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      });
    }
    if (err.validation) return send(400, { code: 'VALIDATION', message: err.message });
    if (err.statusCode === 404) return send(404, { code: 'NOT_FOUND', message: 'Not found' });
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      // Never echo err.message: plugins and libraries put internal detail there.
      return send(err.statusCode, {
        code: 'BAD_REQUEST',
        message: 'Request could not be processed',
      });
    }
    req.log.error({ err: safeError(err) });
    return send(500, { code: 'INTERNAL', message: 'Something went wrong' });
  });

  return app;
}
