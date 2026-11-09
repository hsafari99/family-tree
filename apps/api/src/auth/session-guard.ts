import { fromNodeHeaders } from 'better-auth/node';
import type { preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../errors.js';
import type { Auth, AuthUser } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by requireSession. */
    user?: AuthUser;
    sessionId?: string;
  }
}

/** preHandler that rejects requests without a valid session and exposes the user. */
export function requireSession(auth: Auth): preHandlerAsyncHookHandler {
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
