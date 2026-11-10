import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { extraLimit } from './limits.js';

async function appWith(limitsOffForDev: boolean, devSwitch: boolean) {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply
      .code(err instanceof AppError ? err.statusCode : 500)
      .send({ code: (err as AppError).code }),
  );
  await app.register(rateLimit, { global: false });
  app.decorate('devLimitsOff', limitsOffForDev);
  app.get(
    '/x',
    { preHandler: extraLimit(app, { name: 'x', max: 2, timeWindow: '1 minute', devSwitch }) },
    async () => 'ok',
  );
  return app;
}
const hits = async (app: Awaited<ReturnType<typeof appWith>>, n: number) => {
  const codes: number[] = [];
  for (let i = 0; i < n; i++) codes.push((await app.inject({ url: '/x' })).statusCode);
  return codes;
};

describe('extraLimit', () => {
  it('limits as usual', async () => {
    expect(await hits(await appWith(false, true), 4)).toEqual([200, 200, 429, 429]);
  });
  it('is skipped when the dev switch is on and the limiter opts in (invite limiters)', async () => {
    expect(await hits(await appWith(true, true), 4)).toEqual([200, 200, 200, 200]);
  });
  it('ignores the dev switch for limiters that do not opt in', async () => {
    expect(await hits(await appWith(true, false), 3)).toEqual([200, 200, 429]);
  });
});
