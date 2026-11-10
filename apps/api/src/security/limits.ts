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
declare module 'fastify' {
  interface FastifyInstance {
    /** True only when AUTH_RATE_LIMIT_ENABLED=false (dev/E2E; production refuses that). */
    devLimitsOff: boolean;
  }
}

export function extraLimit(
  app: FastifyInstance,
  {
    name,
    max,
    timeWindow,
    by = 'ip',
    devSwitch = false,
  }: {
    name: string;
    max: number;
    timeWindow: string;
    by?: 'ip' | 'user';
    /** Also turned off by AUTH_RATE_LIMIT_ENABLED=false (the invite limiters, for E2E). */
    devSwitch?: boolean;
  },
) {
  const check = app.createRateLimit({
    max,
    timeWindow,
    // by: 'user' falls back to the per-IP bucket when there is no req.user, so routes using it
    // must require a session first.
    keyGenerator: (req) =>
      `${name}:${by === 'user' && req.user ? `u:${req.user.id}` : `ip:${clientKey(req)}`}`,
  });
  return async (req: FastifyRequest) => {
    if (devSwitch && app.devLimitsOff) return;
    const result = await check(req);
    if (!result.isAllowed && result.isExceeded) throw rateLimited();
  };
}
