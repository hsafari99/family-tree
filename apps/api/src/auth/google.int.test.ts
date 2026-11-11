import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, WEB_ORIGIN } from '../../test/auth-helpers.js';
import { startGoogle, TEST_GOOGLE } from '../../test/google-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';

const baseConfig = loadConfig();
const config = { ...baseConfig, google: TEST_GOOGLE };
const deps = createDeps(config);
const { db } = deps;
const auth = createAuth({ config, db, rateLimitEnabled: false });
const authWithoutGoogle = createAuth({
  config: { ...baseConfig, google: null },
  db,
  rateLimitEnabled: false,
});

let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  app = buildApp({ config, checks: deps.checks, auth, db });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await deps.close();
});

describe('provider wiring', () => {
  it('says Google is on and builds the authorization URL with only openid, email and profile', async () => {
    const providers = await call(app, 'GET', '/api/v1/auth/providers');
    expect(providers.statusCode).toBe(200);
    expect(providers.json()).toEqual({ google: true });

    const { res, url } = await startGoogle(app);
    expect(res.statusCode).toBe(200);
    const authUrl = new URL(url);
    expect(authUrl.origin).toBe('https://accounts.google.com');
    expect(authUrl.pathname).toBe('/o/oauth2/v2/auth');
    const q = authUrl.searchParams;
    expect(q.get('client_id')).toBe(TEST_GOOGLE.clientId);
    expect(q.get('redirect_uri')).toBe(`${config.AUTH_BASE_URL}/api/auth/callback/google`);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toBeTruthy();
    expect(new Set(q.get('scope')!.split(' '))).toEqual(new Set(['openid', 'email', 'profile']));
    expect(q.has('include_granted_scopes')).toBe(false);
  });

  it('is off without the client, and the sign-in is refused', async () => {
    const off = buildApp({ config, checks: deps.checks, auth: authWithoutGoogle, db });
    try {
      expect((await call(off, 'GET', '/api/v1/auth/providers')).json()).toEqual({
        google: false,
      });
      const { res } = await startGoogle(off);
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('PROVIDER_NOT_FOUND');
    } finally {
      await off.close();
    }
  });

  it('the providers answer is public', async () => {
    const res = await call(app, 'GET', '/api/v1/auth/providers', {
      headers: { origin: WEB_ORIGIN },
    });
    expect(res.statusCode).toBe(200);
  });
});
