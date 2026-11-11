import { setPasswordSchema } from '@family-tree/shared';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Auth } from '../auth/auth.js';
import { GOOGLE_PROVIDER_ID } from '../auth/google.js';
import { requireSession } from '../auth/session-guard.js';
import type { Db } from '../db/client.js';
import { accounts } from '../db/schema.js';
import { AppError, parseBody } from '../errors.js';

const ACCOUNT_LIMIT = { rateLimit: { max: 10, timeWindow: '15 minutes' } };

/** Account settings for sign-in methods: disconnect Google, give a Google-only account a password. */
export const accountRoutes: FastifyPluginAsync<{ auth: Auth; db: Db }> = async (
  app,
  { auth, db },
) => {
  // Spec §5: never leave an account with no way in. Linking is Better Auth's /link-social
  // (re-authenticated in auth/google.ts); unlinking is here so the password check and the
  // delete happen in one transaction.
  app.post(
    '/api/v1/account/google/disconnect',
    { config: ACCOUNT_LIMIT, preHandler: requireSession(auth) },
    async (req, reply) => {
      const userId = req.user!.id;
      await db.transaction(async (tx) => {
        const owned = await tx
          .select({ providerId: accounts.providerId, password: accounts.password })
          .from(accounts)
          .where(eq(accounts.userId, userId))
          .for('update');
        if (!owned.some((a) => a.providerId === GOOGLE_PROVIDER_ID)) {
          throw new AppError('GOOGLE_NOT_CONNECTED', 404, 'Google is not connected');
        }
        if (!owned.some((a) => a.providerId === 'credential' && a.password !== null)) {
          throw new AppError(
            'PASSWORD_REQUIRED_TO_DISCONNECT',
            409,
            'Set a password before disconnecting Google',
          );
        }
        await tx
          .delete(accounts)
          .where(and(eq(accounts.userId, userId), eq(accounts.providerId, GOOGLE_PROVIDER_ID)));
      });
      req.log.info({ event: 'google_disconnected', userId }, 'Google disconnected');
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/v1/account/password',
    { config: ACCOUNT_LIMIT, preHandler: requireSession(auth) },
    async (req, reply) => {
      const { newPassword } = parseBody(setPasswordSchema, req.body);
      const [existing] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, req.user!.id),
            eq(accounts.providerId, 'credential'),
            isNotNull(accounts.password),
          ),
        );
      if (existing) {
        throw new AppError('PASSWORD_ALREADY_SET', 409, 'This account already has a password');
      }
      try {
        await auth.api.setPassword({
          body: { newPassword },
          headers: fromNodeHeaders(req.headers),
        });
      } catch (err) {
        if (isAPIError(err) && err.body?.code === 'PASSWORD_ALREADY_SET') {
          throw new AppError('PASSWORD_ALREADY_SET', 409, 'This account already has a password');
        }
        throw err;
      }
      return reply.code(204).send();
    },
  );
};
