import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, type CookieJar, signUp, WEB_ORIGIN } from '../../test/auth-helpers.js';
import {
  googleProfile,
  googleSignIn,
  startGoogle,
  TEST_GOOGLE,
} from '../../test/google-helpers.js';
import { accounts, users } from '../db/schema.js';
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

const me = (jar: CookieJar) => call(app, 'GET', '/api/v1/me', { jar });
const googleAccounts = (userId: string) =>
  db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'google')));
const EMAIL_TAKEN_REDIRECT = `${WEB_ORIGIN}/sign-in?error=account_not_linked`;

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

describe('signing in with Google', () => {
  it('creates a new user named from the Google profile and signs them in', async () => {
    const profile = googleProfile({ name: 'Ada Lovelace', email: `Ada-${Date.now()}@Gmail.com` });
    const { res, location, jar, google } = await googleSignIn(app, profile);
    expect(res.statusCode).toBe(302);
    expect(location).toBe(`${WEB_ORIGIN}/`);
    expect(google.tokenRequests).toHaveLength(1);
    expect(google.tokenRequests[0]!.get('redirect_uri')).toBe(
      `${config.AUTH_BASE_URL}/api/auth/callback/google`,
    );

    const session = await me(jar);
    expect(session.statusCode).toBe(200);
    const user = session.json().user;
    expect(user.name).toBe('Ada Lovelace');
    expect(user.email).toBe(profile.email.toLowerCase());
    const linked = await googleAccounts(user.id);
    expect(linked.map((a) => a.accountId)).toEqual([profile.sub]);
  });

  it('signs the same Google account into the same user next time', async () => {
    const profile = googleProfile();
    const first = await googleSignIn(app, profile);
    const firstId = (await me(first.jar)).json().user.id;
    const again = await googleSignIn(app, { ...profile, name: 'Renamed At Google' });
    const user = (await me(again.jar)).json().user;
    expect(user.id).toBe(firstId);
    expect(user.name).toBe(profile.name);
    expect(await googleAccounts(firstId)).toHaveLength(1);
  });

  it('refuses a Google email that matches a password account, without linking', async () => {
    const existing = await signUp(app, { email: `taken-${Date.now()}@gmail.com` });
    const profile = googleProfile({ email: existing.email.toUpperCase() });
    const { res, location, jar } = await googleSignIn(app, profile);
    expect(res.statusCode).toBe(302);
    expect(location).toBe(EMAIL_TAKEN_REDIRECT);
    expect((await me(jar)).statusCode).toBe(401);
    expect(await googleAccounts(existing.userId)).toEqual([]);
  });

  it('refuses even when the local email is marked verified', async () => {
    const existing = await signUp(app);
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, existing.userId));
    const { location, jar } = await googleSignIn(app, googleProfile({ email: existing.email }));
    expect(location).toBe(EMAIL_TAKEN_REDIRECT);
    expect((await me(jar)).statusCode).toBe(401);
    expect(await googleAccounts(existing.userId)).toEqual([]);
  });

  it('sends callback failures to the web sign-in page, not an API error page', async () => {
    const res = await call(app, 'GET', '/api/auth/callback/google?code=x', {
      headers: { origin: undefined },
    });
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toBe(`${WEB_ORIGIN}/sign-in?error=state_not_found`);
  });
});
