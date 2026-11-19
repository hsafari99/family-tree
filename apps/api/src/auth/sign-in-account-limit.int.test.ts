import { afterAll, describe, expect, it } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';

// Better Auth's own per-IP limiter is off here: only the per-account limit is under test.
const config = { ...loadConfig(), TRUST_PROXY: 1 };
const deps = createDeps(config);
const auth = createAuth({ config, db: deps.db, rateLimitEnabled: false });
const app = buildApp({ config, checks: deps.checks, auth, db: deps.db });

afterAll(async () => {
  await app.close();
  await deps.close();
});

describe('per-account sign-in limit', () => {
  it('blocks the 11th password attempt for one email in 15 minutes, from any IP', async () => {
    const { email, password } = await signUp(app);
    const attempt = (ip: string, body: Record<string, string>) =>
      call(app, 'POST', '/api/auth/sign-in/email', {
        body,
        headers: { 'x-forwarded-for': ip },
      });
    for (let i = 0; i < 10; i++) {
      const res = await attempt(`198.51.100.${i + 1}`, { email, password: 'Not the password1' });
      expect(res.statusCode).toBe(401);
    }
    // Another IP, another spelling of the email, the right password: still blocked.
    const blocked = await attempt('203.0.113.50', { email: ` ${email.toUpperCase()}`, password });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    // The same path spelled differently is the same route.
    const spelled = await call(app, 'POST', '/api/auth//sign-in/email/', {
      body: { email, password },
      headers: { 'x-forwarded-for': '203.0.113.51' },
    });
    expect(spelled.statusCode).toBe(429);

    // Other accounts are unaffected.
    const other = await signUp(app);
    const ok = await attempt('203.0.113.52', { email: other.email, password: other.password });
    expect(ok.statusCode).toBe(200);
  });
});
