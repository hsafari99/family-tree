import { afterAll, describe, expect, it } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';

const config = loadConfig({ ...process.env, AUTH_RATE_LIMIT_ENABLED: 'false' });
const deps = createDeps(config);
const auth = createAuth({ config, db: deps.db }); // no explicit rateLimitEnabled: from config
const app = buildApp({ config, checks: deps.checks, auth, db: deps.db });

afterAll(async () => {
  await app.close();
  await deps.close();
});

describe('AUTH_RATE_LIMIT_ENABLED=false', () => {
  it('lets more than 5 failed sign-ins through (E2E only; production refuses it)', async () => {
    const { email } = await signUp(app);
    for (let i = 0; i < 7; i++) {
      const res = await call(app, 'POST', '/api/auth/sign-in/email', {
        body: { email, password: 'not the password' },
      });
      expect(res.statusCode).toBe(401);
    }
  });
});
