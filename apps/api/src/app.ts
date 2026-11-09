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
}

export function buildApp({ config, checks, rateLimitMax = 300 }: AppOptions) {
  const app = Fastify({
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
  });

  app.register(helmet);
  app.register(cors, { origin: [config.WEB_ORIGIN], credentials: true });
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
