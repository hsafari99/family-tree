import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { ApiError } from '@family-tree/shared';
import Fastify, { type FastifyError } from 'fastify';
import type { Config } from './config.js';
import { healthRoutes, type HealthChecks } from './routes/health.js';

export interface AppOptions {
  config: Config;
  checks: HealthChecks;
}

export function buildApp({ config, checks }: AppOptions) {
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
  app.register(healthRoutes, { checks });

  app.setNotFoundHandler((_req, reply) => {
    const body: ApiError = { error: { code: 'NOT_FOUND', message: 'Not found' } };
    return reply.code(404).send(body);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.validation) {
      const body: ApiError = { error: { code: 'VALIDATION', message: err.message } };
      return reply.code(400).send(body);
    }
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error(err);
    const body: ApiError =
      status === 500
        ? { error: { code: 'INTERNAL', message: 'Something went wrong' } }
        : { error: { code: 'BAD_REQUEST', message: err.message } };
    return reply.code(status).send(body);
  });

  return app;
}
