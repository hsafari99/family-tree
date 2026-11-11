import { twoFactorMoveConfirmSchema, twoFactorMoveStartSchema } from '@family-tree/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Auth } from '../auth/auth.js';
import { requireSession } from '../auth/session-guard.js';
import { checkSecondFactor } from '../auth/totp-reset.js';
import { cancelMove, confirmMove, startMove } from '../auth/two-factor-move.js';
import type { Db } from '../db/client.js';
import { sessions, twoFactors } from '../db/schema.js';
import { AppError, parseBody } from '../errors.js';
import { extraLimit } from '../security/limits.js';
import { RECENT_SIGN_IN_MS } from './account.js';
import { signInMethods } from './me.js';

const BASE = '/api/v1/account/two-factor/move';

const locked = () =>
  new AppError(
    'ACCOUNT_TEMPORARILY_LOCKED',
    429,
    'Too many wrong codes. Two-step verification is locked for 15 minutes',
  );
const invalidCode = () => new AppError('INVALID_CODE', 400, 'Invalid code');

/**
 * Spec §5: move two-step verification to a new phone without ever turning it off
 * (auth/two-factor-move.ts). Start re-authenticates and keeps a new secret pending; confirm
 * checks a code from the new phone and swaps it in; cancel drops the pending secret.
 *
 * The routes check a password or a code, so each has a per-IP limit (the route-level one) and a
 * tighter per-user one. Wrong codes also count toward the 2FA lockout.
 */
export const twoFactorMoveRoutes: FastifyPluginAsync<{ auth: Auth; db: Db }> = async (
  app,
  { auth, db },
) => {
  app.post(
    `${BASE}/start`,
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      preHandler: [
        requireSession(auth),
        extraLimit(app, {
          name: 'two-factor-move-start',
          max: 5,
          timeWindow: '15 minutes',
          by: 'user',
        }),
      ],
    },
    async (req, reply) => {
      const { password, code } = parseBody(twoFactorMoveStartSchema, req.body);
      const user = req.user!;
      const log = req.log.child({ event: 'two_factor_move_failed', userId: user.id });

      const [current] = await db
        .select({ id: twoFactors.id })
        .from(twoFactors)
        .where(and(eq(twoFactors.userId, user.id), eq(twoFactors.verified, true)));
      if (!user.twoFactorEnabled || !current) {
        throw new AppError('TWO_FACTOR_NOT_ENABLED', 409, 'Two-step verification is off');
      }

      const ctx = await auth.$context;
      if ((await signInMethods(db, user.id)).hasPassword) {
        if (!password) throw new AppError('PASSWORD_REQUIRED', 400, 'Enter your password');
        const credential = await ctx.internalAdapter.findCredentialAccount(user.id);
        const valid =
          credential?.password != null &&
          (await ctx.password.verify({ hash: credential.password, password }));
        if (!valid) {
          log.warn({ reason: 'invalid_password' }, '2FA move not started');
          throw new AppError('INVALID_PASSWORD', 400, 'Invalid password');
        }
      } else {
        // No password to re-check (a Google-only account): the proof is a fresh sign-in, as for
        // setting a password (routes/account.ts).
        const [session] = await db
          .select({ createdAt: sessions.createdAt })
          .from(sessions)
          .where(eq(sessions.id, req.sessionId!));
        if (!session || Date.now() - session.createdAt.getTime() > RECENT_SIGN_IN_MS) {
          throw new AppError(
            'RECENT_SIGN_IN_REQUIRED',
            403,
            'Sign in with Google again to move two-step verification',
          );
        }
      }

      const trimmed = code?.trim() ?? '';
      if (trimmed === '') {
        throw new AppError('TWO_FACTOR_CODE_REQUIRED', 400, 'Enter your authenticator code');
      }
      const check = await checkSecondFactor(db, ctx.secretConfig, user.id, trimmed, {
        countFailures: true,
      });
      if (check.result === 'locked') {
        log.warn({ reason: 'locked' }, '2FA move not started');
        throw locked();
      }
      if (check.result !== 'valid') {
        log.warn({ reason: 'invalid_code' }, '2FA move not started');
        throw invalidCode();
      }

      const started = await startMove(db, ctx.secretConfig, {
        userId: user.id,
        sessionId: req.sessionId!,
        email: user.email,
      });
      req.log.info(
        { event: 'two_factor_move_started', userId: user.id, via: check.via },
        '2FA move started',
      );
      // Carries the new secret: never cached.
      return reply.header('cache-control', 'no-store').send(started);
    },
  );

  app.post(
    `${BASE}/confirm`,
    {
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
      preHandler: [
        requireSession(auth),
        extraLimit(app, {
          name: 'two-factor-move-confirm',
          max: 10,
          timeWindow: '15 minutes',
          by: 'user',
        }),
      ],
    },
    async (req, reply) => {
      const { code } = parseBody(twoFactorMoveConfirmSchema, req.body);
      const userId = req.user!.id;
      const ctx = await auth.$context;
      const outcome = await confirmMove(db, ctx.secretConfig, {
        userId,
        sessionId: req.sessionId!,
        code,
      });
      if (outcome.status === 'moved') {
        req.log.info(
          {
            event: 'two_factor_moved',
            userId,
            otherSessionsRevoked: outcome.otherSessionsRevoked,
          },
          '2FA moved to a new phone',
        );
        // Carries the new recovery codes: never cached.
        return reply.header('cache-control', 'no-store').send({ backupCodes: outcome.backupCodes });
      }
      req.log.warn(
        { event: 'two_factor_move_failed', userId, reason: outcome.status },
        '2FA move not confirmed',
      );
      switch (outcome.status) {
        case 'not_started':
          throw new AppError('MOVE_NOT_STARTED', 404, 'Start moving two-step verification again');
        case 'expired':
          throw new AppError('MOVE_EXPIRED', 410, 'This took too long. Start again');
        case 'locked':
          throw locked();
        case 'invalid':
          throw invalidCode();
      }
    },
  );

  app.post(`${BASE}/cancel`, { preHandler: requireSession(auth) }, async (req, reply) => {
    const userId = req.user!.id;
    if (await cancelMove(db, userId)) {
      req.log.info({ event: 'two_factor_move_cancelled', userId }, '2FA move cancelled');
    }
    return reply.code(204).send();
  });
};
