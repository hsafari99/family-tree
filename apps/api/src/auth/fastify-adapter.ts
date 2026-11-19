import type { ApiError } from '@family-tree/shared';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { extraLimit } from '../security/limits.js';
import type { Auth } from './auth.js';

/** Carries Fastify's request.ip to Better Auth; any client-sent value is overwritten. */
export const CLIENT_IP_HEADER = 'x-ft-client-ip';

/**
 * Removes session tokens from a JSON body. The browser gets the token only as an HttpOnly
 * cookie; echoing it in the body would hand it to any script on the page. Applied to every
 * Better Auth JSON response (sign-in, sign-up, get-session, two-factor verify, change-password
 * and any path spelling that reaches them), and to each item of an array such as list-sessions,
 * so a script can't collect every session of the user. Revoking one session by its token is
 * therefore not offered to the browser; revoke-other-sessions and revoke-sessions still work.
 */
export function stripSessionToken(body: unknown): { body: unknown; changed: boolean } {
  if (Array.isArray(body)) {
    let changed = false;
    const items = body.map((item) => {
      const r = stripSessionToken(item);
      changed ||= r.changed;
      return r.body;
    });
    return { body: changed ? items : body, changed };
  }
  if (body === null || typeof body !== 'object') {
    return { body, changed: false };
  }
  const copy: Record<string, unknown> = { ...body };
  let changed = false;
  if ('token' in copy) {
    delete copy.token;
    changed = true;
  }
  const session = copy.session;
  if (session !== null && typeof session === 'object' && 'token' in session) {
    const rest: Record<string, unknown> = { ...session };
    delete rest.token;
    copy.session = rest;
    changed = true;
  }
  return { body: copy, changed };
}

const notFound: ApiError = { error: { code: 'NOT_FOUND', message: 'Not found' } };

/** The Better Auth path a request reaches, however it is spelled (encoding, double slashes). */
const authPath = (req: FastifyRequest) =>
  `/${(req.params as { '*'?: string })['*'] ?? ''}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

/** Mounts Better Auth's handler at /api/auth/*. */
export const authRoutes: FastifyPluginAsync<{ auth: Auth }> = async (app, { auth }) => {
  // Better Auth limits sign-in per IP only. This caps password guesses per account too, so
  // credential stuffing spread over many IPs is still slowed.
  const signInPerAccount = extraLimit(app, {
    name: 'sign-in-account',
    max: 10,
    timeWindow: '15 minutes',
    by: 'email',
    devSwitch: true,
  });
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async preHandler(request) {
      if (request.method === 'POST' && authPath(request) === '/sign-in/email') {
        await signInPerAccount(request);
      }
    },
    async handler(request, reply) {
      const headers = fromNodeHeaders(request.headers);
      headers.set(CLIENT_IP_HEADER, request.ip);
      const response = await auth.handler(
        new Request(new URL(request.url, auth.options.baseURL), {
          method: request.method,
          headers,
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
        }),
      );
      // Sign-in with 2FA sets three cookies; Headers.forEach would merge them into one.
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);

      const raw = response.body ? Buffer.from(await response.arrayBuffer()) : null;
      if (response.status === 404 && (raw === null || raw.length === 0)) {
        return reply.code(404).send(notFound);
      }

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie' && key !== 'content-length') reply.header(key, value);
      });
      if (raw && response.headers.get('content-type')?.includes('application/json')) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          return reply.send(raw);
        }
        const stripped = stripSessionToken(parsed);
        if (stripped.changed) return reply.send(JSON.stringify(stripped.body));
      }
      return reply.send(raw);
    },
  });
};
