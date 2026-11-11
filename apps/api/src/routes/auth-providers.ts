import type { FastifyPluginAsync } from 'fastify';
import type { Auth } from '../auth/auth.js';

export interface AuthProvidersResponse {
  google: boolean;
}

/** Public: which sign-in methods besides email and password are on, so the web app can show them. */
export const authProvidersRoutes: FastifyPluginAsync<{ auth: Auth }> = async (app, { auth }) => {
  const body: AuthProvidersResponse = { google: Boolean(auth.options.socialProviders?.google) };
  app.get('/api/v1/auth/providers', async () => body);
};
