import type { MeResponse } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Auth } from '../auth/auth.js';
import { GOOGLE_PROVIDER_ID } from '../auth/google.js';
import { requireSession } from '../auth/session-guard.js';
import type { Db } from '../db/client.js';
import { accounts } from '../db/schema.js';
import { holdsTwoFactorRole } from '../trees/roles.js';

/** Which ways in an account has: a password, and whether Google is connected. */
export async function signInMethods(db: Db, userId: string) {
  const rows = await db
    .select({ providerId: accounts.providerId, password: accounts.password })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  return {
    hasPassword: rows.some((r) => r.providerId === 'credential' && r.password !== null),
    googleConnected: rows.some((r) => r.providerId === GOOGLE_PROVIDER_ID),
  };
}

export const meRoutes: FastifyPluginAsync<{ auth: Auth; db: Db }> = async (app, { auth, db }) => {
  app.get('/api/v1/me', { preHandler: requireSession(auth) }, async (req) => {
    const user = req.user!;
    const body: MeResponse = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        twoFactorEnabled: user.twoFactorEnabled ?? false,
        requiresTwoFactor: await holdsTwoFactorRole(db, user.id),
        ...(await signInMethods(db, user.id)),
      },
    };
    return body;
  });
};
