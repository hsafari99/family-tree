import { afterAll, describe, expect, it } from 'vitest';
import { startGoogle, TEST_GOOGLE } from '../../test/google-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';

// Own file: Better Auth's memory rate-limit store is shared by every instance in a file.
const config = { ...loadConfig(), google: TEST_GOOGLE };
const deps = createDeps(config);
const auth = createAuth({ config, db: deps.db });
const app = buildApp({ config, checks: deps.checks, auth, db: deps.db });

afterAll(async () => {
  await app.close();
  await deps.close();
});

describe('Google sign-in rate limit', () => {
  it('allows 10 starts a minute from one IP', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await startGoogle(app)).res.statusCode).toBe(200);
    }
    expect((await startGoogle(app)).res.statusCode).toBe(429);
  });
});
