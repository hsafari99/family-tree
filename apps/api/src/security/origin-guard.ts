import type { onRequestHookHandler } from 'fastify';
import { AppError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for our own API: a state-changing /api/v1 request must carry the web app's
 * Origin. Browsers always send Origin on cross-site and on same-origin non-GET fetches, so a
 * missing header is treated as foreign. /api/auth is left to Better Auth's own origin check.
 */
export function originGuard(webOrigin: string): onRequestHookHandler {
  return async (req) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/v1/')) return;
    if (req.headers.origin !== webOrigin) {
      throw new AppError('FORBIDDEN', 403, 'Request origin not allowed');
    }
  };
}
