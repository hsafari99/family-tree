import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { ApiError } from '@family-tree/shared';
import Fastify, { type FastifyError } from 'fastify';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { healthRoutes, type HealthChecks } from './routes/health.js';

export interface AppOptions {
  config: Config;
  checks: HealthChecks;
  /** Global per-IP requests per minute (default 300). Routes may set their own limit. */
  rateLimitMax?: number;
  /** Where log lines go (default stdout). Tests pass a stream to inspect them. */
  logStream?: { write(line: string): void };
}

/**
 * Trust exactly `hops` proxies counted from the socket peer, so req.ip is the address the
 * outermost trusted proxy saw. Never `true`: that takes the leftmost X-Forwarded-For entry,
 * which the client controls. A function because Fastify 5.12 treats a numeric trustProxy as
 * "trust nothing". Only safe when the API is reachable solely through those proxies.
 */
function trustHops(hops: number) {
  return hops > 0 ? (_address: string, hop: number) => hop < hops : false;
}

export function buildApp({ config, checks, rateLimitMax = 300, logStream }: AppOptions) {
  const app = Fastify({
    trustProxy: trustHops(config.TRUST_PROXY),
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            ...(logStream ? { stream: logStream } : {}),
          },
  });

  app.register(helmet);
  app.register(cors, { origin: [config.WEB_ORIGIN], credentials: true });
  // Every route must be registered inside a plugin (app.register) after this line; routes added
  // directly on `app`, or before this plugin, are not rate-limited.
  app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: '1 minute',
    errorResponseBuilder: () =>
      new AppError('RATE_LIMITED', 429, 'Too many requests, try again later'),
  });
  app.register(healthRoutes, { checks });

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
      if (err.statusCode >= 500) req.log.error(err);
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
    req.log.error(err);
    return send(500, { code: 'INTERNAL', message: 'Something went wrong' });
  });

  return app;
}
