import { setPasswordSchema } from '@family-tree/shared';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Auth } from '../auth/auth.js';
import { GOOGLE_PROVIDER_ID, reauthenticate } from '../auth/google.js';
import { requireSession } from '../auth/session-guard.js';
import type { Db } from '../db/client.js';
import { accounts, sessions } from '../db/schema.js';
import { AppError, parseBody } from '../errors.js';

/** Setting a password on a Google-only account needs a sign-in at most this old. */
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

// Both routes check a password or a code, like Better Auth's /link-social (5 per 15 minutes).
const ACCOUNT_LIMIT = { rateLimit: { max: 5, timeWindow: '15 minutes' } };

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
      const [credential] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.providerId, 'credential'),
            isNotNull(accounts.password),
          ),
        );
      // Only re-check what exists: a Google-only account gets the answer below instead.
      if (credential) {
        const failure = await reauthenticate(await auth.$context, db, req.user!, req.body);
        if (failure) throw new AppError(failure.code, 400, failure.message);
      }
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
      const userId = req.user!.id;
      // There's no password to re-check, so the proof is a fresh Google sign-in: otherwise a
      // borrowed or stolen session could add a permanent password login.
      const [current] = await db
        .select({ createdAt: sessions.createdAt })
        .from(sessions)
        .where(eq(sessions.id, req.sessionId!));
      if (!current || Date.now() - current.createdAt.getTime() > RECENT_SIGN_IN_MS) {
        throw new AppError(
          'RECENT_SIGN_IN_REQUIRED',
          403,
          'Sign in with Google again to set a password',
        );
      }
      const [existing] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
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
      // A new way in: end every other session, as a password change does.
      await db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), ne(sessions.id, req.sessionId!)));
      return reply.code(204).send();
    },
  );
};
