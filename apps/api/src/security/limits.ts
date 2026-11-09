import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';

/** IPv6 collapses to its /64 (as @fastify/rate-limit's default key does). */
export const clientKey = (req: FastifyRequest) => normalizeIP(req.ip);

export const rateLimited = () =>
  new AppError('RATE_LIMITED', 429, 'Too many requests, try again later');

/**
 * A preHandler enforcing an extra limit on top of the global one. Built with createRateLimit,
 * not app.rateLimit: handlers from app.rateLimit share a "limit already ran" flag with the
 * route-level limit, so whichever ran first would silently disable the other.
 * `by` picks the bucket: the client IP (default) or the signed-in user.
 */
export function extraLimit(
  app: FastifyInstance,
  {
    name,
    max,
    timeWindow,
    by = 'ip',
  }: { name: string; max: number; timeWindow: string; by?: 'ip' | 'user' },
) {
  const check = app.createRateLimit({
    max,
    timeWindow,
    keyGenerator: (req) =>
      `${name}:${by === 'user' && req.user ? `u:${req.user.id}` : `ip:${clientKey(req)}`}`,
  });
  return async (req: FastifyRequest) => {
    const result = await check(req);
    if (!result.isAllowed && result.isExceeded) throw rateLimited();
  };
}
