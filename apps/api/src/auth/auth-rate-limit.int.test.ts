import { afterAll, describe, expect, it } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';

// Own file: Better Auth's memory rate-limit store is shared by every instance in a file.
const config = loadConfig();
const deps = createDeps(config);
const auth = createAuth({ config, db: deps.db });
const app = buildApp({ config, checks: deps.checks, auth });

afterAll(async () => {
  await app.close();
  await deps.close();
});

describe("Better Auth's rate limiter", () => {
  it('blocks the 6th sign-in a minute from one IP, whatever X-Forwarded-For says', async () => {
    expect(config.TRUST_PROXY).toBe(0);
    const { email } = await signUp(app);
    const attempt = (forwardedFor: string) =>
      call(app, 'POST', '/api/auth/sign-in/email', {
        body: { email, password: 'not the password' },
        headers: { 'x-forwarded-for': forwardedFor },
      });
    for (let i = 0; i < 5; i++) {
      expect((await attempt(`198.51.100.${i}`)).statusCode).toBe(401);
    }
    expect((await attempt('198.51.100.200')).statusCode).toBe(429);
    expect((await attempt('203.0.113.9')).statusCode).toBe(429);
  });
});
