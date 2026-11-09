import type { CheckStatus, HealthResponse } from '@family-tree/shared';
import type { FastifyPluginAsync } from 'fastify';

export interface HealthChecks {
  checkDb(): Promise<void>;
  checkStorage(): Promise<void>;
}

async function probe(check: () => Promise<void>, timeoutMs: number): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoutes: FastifyPluginAsync<{
  checks: HealthChecks;
  timeoutMs?: number;
}> = async (app, { checks, timeoutMs = 2000 }) => {
  app.get('/api/v1/health', async (_req, reply) => {
    const [db, storage] = await Promise.all([
      probe(() => checks.checkDb(), timeoutMs),
      probe(() => checks.checkStorage(), timeoutMs),
    ]);
    const healthy = db === 'ok' && storage === 'ok';
    const body: HealthResponse = { status: healthy ? 'ok' : 'degraded', checks: { db, storage } };
    return reply.code(healthy ? 200 : 503).send(body);
  });
};
