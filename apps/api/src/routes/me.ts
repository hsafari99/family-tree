import type { MeResponse } from '@family-tree/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Auth } from '../auth/auth.js';
import { requireSession } from '../auth/session-guard.js';
import type { Db } from '../db/client.js';
import { holdsTwoFactorRole } from '../trees/roles.js';

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
      },
    };
    return body;
  });
};
