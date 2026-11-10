import { z } from 'zod';

/**
 * In a browser under a strict CSP (no 'unsafe-eval'), Zod's probe `Function('')`, which decides
 * whether to compile validators, is caught but still reported as a CSP violation. So browsers
 * skip the compiled fast path; the server (no `document`) keeps it. This must run before any
 * schema is built, which is why `index.ts` imports it first.
 */
if ('document' in globalThis) z.config({ jitless: true });
