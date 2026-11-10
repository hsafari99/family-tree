import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import type { Auth, AuthUser } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by requireSession. */
    user?: AuthUser;
    sessionId?: string;
  }
}

/** Rejects requests without a valid session and exposes the user. Usable as onRequest or preHandler. */
export function requireSession(
  auth: Auth,
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (req, reply) => {
    const { headers, response: session } = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      returnHeaders: true,
    });
    // A daily session refresh re-issues the cookie; pass it on so its expiry moves too.
    const cookies = headers.getSetCookie();
    if (cookies.length > 0) reply.header('set-cookie', cookies);
    if (!session) throw new AppError('UNAUTHENTICATED', 401, 'Sign in required');
    req.user = session.user;
    req.sessionId = session.session.id;
  };
}
