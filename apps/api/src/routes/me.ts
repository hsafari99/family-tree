import type { MeResponse } from '@family-tree/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Auth } from '../auth/auth.js';
import { requireSession } from '../auth/session-guard.js';

export const meRoutes: FastifyPluginAsync<{ auth: Auth }> = async (app, { auth }) => {
  app.get('/api/v1/me', { preHandler: requireSession(auth) }, async (req) => {
    const user = req.user!;
    const body: MeResponse = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        twoFactorEnabled: user.twoFactorEnabled ?? false,
      },
    };
    return body;
  });
};
