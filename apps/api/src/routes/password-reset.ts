import { resetWithCodeSchema } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Auth } from '../auth/auth.js';
import { verifyAndConsumeSecondFactor } from '../auth/totp-reset.js';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { AppError, parseBody } from '../errors.js';

const invalidReset = () => new AppError('INVALID_RESET', 400, 'Email or code is incorrect');

/** Rate-limit key for one account: the normalised email, or the IP if there is none. */
function normalisedEmailOrIp(req: FastifyRequest): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.trim() !== ''
    ? `email:${email.trim().toLowerCase()}`
    : `ip:${req.ip}`;
}

const RATE_LIMITED = () => new AppError('RATE_LIMITED', 429, 'Too many requests, try again later');

export const passwordResetRoutes: FastifyPluginAsync<{ auth: Auth; db: Db }> = async (
  app,
  { auth, db },
) => {
  /** Sets the new password (already hashed) and signs the user out everywhere. */
  async function applyNewPassword(userId: string, hash: string) {
    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(userId, hash);
    await ctx.internalAdapter.deleteUserSessions(userId);
  }

  /**
   * An extra per-IP cap. Built with createRateLimit, not app.rateLimit: handlers from
   * app.rateLimit share a "limit already ran" flag with the route-level limit, so whichever runs
   * first would silently disable the other.
   */
  function perIpLimit(max: number) {
    const check = app.createRateLimit({
      max,
      timeWindow: '15 minutes',
      keyGenerator: (req) => `reset-ip:${req.routeOptions.url}:${req.ip}`,
    });
    return async (req: FastifyRequest) => {
      const result = await check(req);
      if (!result.isAllowed && result.isExceeded) throw RATE_LIMITED();
    };
  }

  app.post(
    '/api/v1/password-reset/totp',
    {
      // A route-level limit replaces the global one. This one caps guesses per account; the
      // per-IP preHandler stops one client spraying guesses across many emails.
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          hook: 'preHandler',
          keyGenerator: (req) => `reset-code:${normalisedEmailOrIp(req)}`,
        },
      },
      preHandler: perIpLimit(20),
    },
    async (req, reply) => {
      const { email, code, newPassword } = parseBody(resetWithCodeSchema, req.body);
      const ctx = await auth.$context;
      // Hash before the lookup, on every path, so timing doesn't reveal which emails exist.
      const newHash = await ctx.password.hash(newPassword);

      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (!user) throw invalidReset();
      // ctx.secretConfig is what Better Auth's two-factor plugin encrypts these records with.
      if (!(await verifyAndConsumeSecondFactor(db, ctx.secretConfig, user.id, code))) {
        throw invalidReset();
      }
      await applyNewPassword(user.id, newHash);
      return reply.code(204).send();
    },
  );
};
