import type { onRequestHookHandler } from 'fastify';
import { AppError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTH_PREFIX = '/api/auth/';

/**
 * CSRF defence: every state-changing request must carry the web app's Origin. Browsers always
 * send Origin on cross-site and on same-origin non-GET fetches, so a missing header is treated
 * as foreign.
 *
 * The decision uses the matched route pattern, not the raw URL: the router decodes the path,
 * so `/api/%761/x` reaches `/api/v1/x` while a raw-URL prefix check would miss it. Deny by
 * default; only Better Auth's routes are exempt, because it checks the origin itself.
 */
export function originGuard(webOrigin: string): onRequestHookHandler {
  return async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    const route = req.routeOptions.url;
    if (route?.startsWith(AUTH_PREFIX)) return;
    if (req.headers.origin !== webOrigin) {
      throw new AppError('FORBIDDEN', 403, 'Request origin not allowed');
    }
  };
}
