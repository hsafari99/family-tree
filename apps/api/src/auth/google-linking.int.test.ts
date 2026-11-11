import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  CookieJar,
  signIn,
  signUp,
  TEST_PASSWORD,
  totpNow,
  WEB_ORIGIN,
} from '../../test/auth-helpers.js';
import {
  finishGoogle,
  googleProfile,
  googleSignIn,
  mockGoogle,
  startGoogle,
  TEST_GOOGLE,
  type GoogleProfile,
} from '../../test/google-helpers.js';
import { userWith2fa } from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { accounts, sessions } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';

const config = { ...loadConfig(), google: TEST_GOOGLE };
const deps = createDeps(config);
const { db } = deps;
const auth = createAuth({ config, db, rateLimitEnabled: false });

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

const ACCOUNT = `${WEB_ORIGIN}/account`;
const me = async (jar: CookieJar) => (await call(app, 'GET', '/api/v1/me', { jar })).json().user;
const providersOf = async (userId: string) =>
  (await db.select().from(accounts).where(eq(accounts.userId, userId)))
    .map((a) => a.providerId)
    .sort();

/** Starts "Connect Google" from Account settings. */
const startLink = (jar: CookieJar, body: Record<string, unknown>) =>
  startGoogle(app, {
    jar,
    path: '/api/auth/link-social',
    body: { callbackURL: `${ACCOUNT}?google=connected`, errorCallbackURL: ACCOUNT, ...body },
  });

/** Connects `profile` to the signed-in jar, all the way through Google's callback. */
async function connect(jar: CookieJar, profile: GoogleProfile, body: Record<string, unknown>) {
  const started = await startLink(jar, body);
  expect(started.res.statusCode).toBe(200);
  return finishGoogle(app, jar, started.url, profile);
}

/** A user who only ever signed in with Google. */
async function googleOnlyUser() {
  const profile = googleProfile();
  const { jar } = await googleSignIn(app, profile);
  return { jar, profile, user: await me(jar) };
}

describe('Connect Google', () => {
  it('links after the password is re-entered, and Google then signs into this account', async () => {
    const user = await signUp(app);
    // A different address from the login name is fine: linking is explicit.
    const profile = googleProfile();
    const { location } = await connect(user.jar, profile, { password: TEST_PASSWORD });
    expect(location).toBe(`${ACCOUNT}?google=connected`);
    expect(await providersOf(user.userId)).toEqual(['credential', 'google']);
    expect((await me(user.jar)).googleConnected).toBe(true);

    const viaGoogle = await googleSignIn(app, profile);
    expect((await me(viaGoogle.jar)).id).toBe(user.userId);
  });

  it('wants the password, and the right one', async () => {
    const user = await signUp(app);
    const none = await startLink(user.jar, {});
    expect(none.res.statusCode).toBe(400);
    expect(none.res.json().code).toBe('PASSWORD_REQUIRED');
    const wrong = await startLink(user.jar, { password: 'not the password' });
    expect(wrong.res.statusCode).toBe(400);
    expect(wrong.res.json().code).toBe('INVALID_PASSWORD');
    expect(wrong.url).toBe('');
  });

  it('wants a current authenticator code too when 2FA is on', async () => {
    const user = await userWith2fa(app);
    const missing = await startLink(user.jar, { password: TEST_PASSWORD });
    expect(missing.res.statusCode).toBe(400);
    expect(missing.res.json().code).toBe('TWO_FACTOR_CODE_REQUIRED');
    const wrong = await startLink(user.jar, { password: TEST_PASSWORD, code: '000000' });
    expect(wrong.res.statusCode).toBe(400);
    expect(wrong.res.json().code).toBe('INVALID_CODE');
    const noPassword = await startLink(user.jar, { code: await totpNow(user.rawSecret) });
    expect(noPassword.res.json().code).toBe('PASSWORD_REQUIRED');

    const { location } = await connect(user.jar, googleProfile(), {
      password: TEST_PASSWORD,
      code: await totpNow(user.rawSecret),
    });
    expect(location).toBe(`${ACCOUNT}?google=connected`);
    expect(await providersOf(user.userId)).toEqual(['credential', 'google']);
  });

  it('refuses the id-token shortcut here too', async () => {
    const user = await signUp(app);
    const google = mockGoogle(googleProfile());
    try {
      const res = await call(app, 'POST', '/api/auth/link-social', {
        jar: user.jar,
        body: { provider: 'google', password: TEST_PASSWORD, idToken: { token: 'x.y.z' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('ID_TOKEN_SIGN_IN_DISABLED');
    } finally {
      google.restore();
    }
    expect(await providersOf(user.userId)).toEqual(['credential']);
  });

  it('needs a signed-in session', async () => {
    const { res } = await startLink(new CookieJar(), { password: TEST_PASSWORD });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a second Google account', async () => {
    const user = await signUp(app);
    await connect(user.jar, googleProfile(), { password: TEST_PASSWORD });
    const again = await startLink(user.jar, { password: TEST_PASSWORD });
    expect(again.res.statusCode).toBe(409);
    expect(again.res.json().code).toBe('GOOGLE_ALREADY_CONNECTED');
  });

  it('allows one account per provider per user in the database', async () => {
    const user = await signUp(app);
    await db
      .insert(accounts)
      .values({ userId: user.userId, providerId: 'google', accountId: `g-${randomUUID()}` });
    await expect(
      db
        .insert(accounts)
        .values({ userId: user.userId, providerId: 'google', accountId: `g-${randomUUID()}` }),
    ).rejects.toThrow();
  });

  it('turns a link that loses a race into the "already connected" message', async () => {
    const user = await signUp(app);
    const otherTab = `g-${randomUUID()}`;
    const started = await startLink(user.jar, { password: TEST_PASSWORD });
    expect(started.res.statusCode).toBe(200);
    // Another tab finished connecting a different Google account in the meantime.
    await db
      .insert(accounts)
      .values({ userId: user.userId, providerId: 'google', accountId: otherTab });
    const { res, location } = await finishGoogle(app, user.jar, started.url, googleProfile());
    expect(res.statusCode).toBe(302);
    expect(location).toBe(`${ACCOUNT}?error=google_already_connected`);
    const google = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, user.userId), eq(accounts.providerId, 'google')));
    expect(google.map((a) => a.accountId)).toEqual([otherTab]);
  });

  it("won't take a Google account that already belongs to someone else", async () => {
    const other = await googleOnlyUser();
    const user = await signUp(app);
    const { location } = await connect(user.jar, other.profile, { password: TEST_PASSWORD });
    expect(location).toBe(`${ACCOUNT}?error=account_already_linked_to_different_user`);
    expect(await providersOf(user.userId)).toEqual(['credential']);
  });
});

describe('Disconnect Google', () => {
  const disconnect = (
    jar?: CookieJar,
    body: Record<string, unknown> = { password: TEST_PASSWORD },
  ) => call(app, 'POST', '/api/v1/account/google/disconnect', { jar, body });

  it('unlinks when the account still has a password', async () => {
    const user = await signUp(app);
    const profile = googleProfile();
    await connect(user.jar, profile, { password: TEST_PASSWORD });
    const res = await disconnect(user.jar);
    expect(res.statusCode).toBe(204);
    expect(await providersOf(user.userId)).toEqual(['credential']);
    expect((await me(user.jar)).googleConnected).toBe(false);
    // That Google account is a stranger again: it would create a new user, not sign in here.
    const viaGoogle = await googleSignIn(app, profile);
    expect((await me(viaGoogle.jar)).id).not.toBe(user.userId);
  });

  it('re-checks the password, and the code when 2FA is on', async () => {
    const user = await signUp(app);
    await connect(user.jar, googleProfile(), { password: TEST_PASSWORD });
    const none = await disconnect(user.jar, {});
    expect(none.statusCode).toBe(400);
    expect(none.json().error.code).toBe('PASSWORD_REQUIRED');
    const wrong = await disconnect(user.jar, { password: 'not the password' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('INVALID_PASSWORD');
    expect(await providersOf(user.userId)).toEqual(['credential', 'google']);

    const tf = await userWith2fa(app);
    await connect(tf.jar, googleProfile(), {
      password: TEST_PASSWORD,
      code: await totpNow(tf.rawSecret),
    });
    const noCode = await disconnect(tf.jar);
    expect(noCode.json().error.code).toBe('TWO_FACTOR_CODE_REQUIRED');
    const badCode = await disconnect(tf.jar, { password: TEST_PASSWORD, code: '000000' });
    expect(badCode.json().error.code).toBe('INVALID_CODE');
    expect(await providersOf(tf.userId)).toEqual(['credential', 'google']);
    const ok = await disconnect(tf.jar, { password: TEST_PASSWORD, code: tf.backupCodes[0] });
    expect(ok.statusCode).toBe(204);
    expect(await providersOf(tf.userId)).toEqual(['credential']);
  });

  it('refuses when Google is the only way in', async () => {
    const { jar, user } = await googleOnlyUser();
    const res = await disconnect(jar);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PASSWORD_REQUIRED_TO_DISCONNECT');
    expect(await providersOf(user.id)).toEqual(['google']);
  });

  it('says so when Google is not connected, and needs a session', async () => {
    const user = await signUp(app);
    const res = await disconnect(user.jar);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('GOOGLE_NOT_CONNECTED');
    expect((await disconnect()).statusCode).toBe(401);
  });

  it("closes Better Auth's own unlink endpoint, which could remove the password login", async () => {
    const user = await signUp(app);
    await connect(user.jar, googleProfile(), { password: TEST_PASSWORD });
    const [credential] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, user.userId), eq(accounts.providerId, 'credential')));
    const res = await call(app, 'POST', '/api/auth/unlink-account', {
      jar: user.jar,
      body: { accountId: credential!.id },
    });
    expect(res.statusCode).toBe(403);
    expect(await providersOf(user.userId)).toEqual(['credential', 'google']);
  });
});

describe('Set a password (Google-only accounts)', () => {
  const setPassword = (jar: CookieJar, newPassword: string) =>
    call(app, 'POST', '/api/v1/account/password', { jar, body: { newPassword } });

  it('adds a password login, after which Google can be disconnected', async () => {
    const { jar, user } = await googleOnlyUser();
    expect(user.hasPassword).toBe(false);
    expect(user.googleConnected).toBe(true);
    expect((await setPassword(jar, 'a brand new password')).statusCode).toBe(204);
    expect((await me(jar)).hasPassword).toBe(true);

    const { res } = await signIn(app, { email: user.email, password: 'a brand new password' });
    expect(res.statusCode).toBe(200);
    const disconnected = await call(app, 'POST', '/api/v1/account/google/disconnect', {
      jar,
      body: { password: 'a brand new password' },
    });
    expect(disconnected.statusCode).toBe(204);
  });

  it('needs a sign-in from the last 10 minutes', async () => {
    const { jar, user } = await googleOnlyUser();
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(sessions.userId, user.id));
    const res = await setPassword(jar, 'a brand new password');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('RECENT_SIGN_IN_REQUIRED');
    expect((await me(jar)).hasPassword).toBe(false);
  });

  it('signs the account out everywhere else', async () => {
    const { jar, profile, user } = await googleOnlyUser();
    const elsewhere = await googleSignIn(app, profile);
    expect((await me(elsewhere.jar)).id).toBe(user.id);
    expect((await setPassword(jar, 'a brand new password')).statusCode).toBe(204);
    expect((await call(app, 'GET', '/api/v1/me', { jar: elsewhere.jar })).statusCode).toBe(401);
    expect((await me(jar)).id).toBe(user.id);
  });

  it('is refused once a password exists, and checks the length', async () => {
    const user = await signUp(app);
    const again = await setPassword(user.jar, 'another long password');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('PASSWORD_ALREADY_SET');
    const { jar } = await googleOnlyUser();
    expect((await setPassword(jar, 'short')).statusCode).toBe(400);
  });
});

describe('/me', () => {
  it('reports the sign-in methods', async () => {
    const user = await signUp(app);
    expect(await me(user.jar)).toMatchObject({ hasPassword: true, googleConnected: false });
  });
});
