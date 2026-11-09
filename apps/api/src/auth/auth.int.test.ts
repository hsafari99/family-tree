import { apiErrorSchema, meResponseSchema } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  call,
  enableTwoFactor,
  signIn,
  signUp,
  TEST_PASSWORD,
  totpNow,
  uniqueEmail,
} from '../../test/auth-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { accounts } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';

const config = loadConfig();
const deps = createDeps(config);
// Better Auth's limiter is off here; auth-rate-limit.int.test.ts covers it.
const auth = createAuth({ config, db: deps.db, rateLimitEnabled: false });
const app = buildApp({ config, checks: deps.checks, auth });

afterAll(async () => {
  await app.close();
  await deps.close();
});

const me = (opts?: Parameters<typeof call>[3]) => call(app, 'GET', '/api/v1/me', opts);

describe('Better Auth email and password', () => {
  it('signs up with an HttpOnly, SameSite=Lax session cookie and serves /me', async () => {
    const { jar, email, res } = await signUp(app, { name: 'Ann Example' });
    const raw = res.headers['set-cookie'];
    const lines = Array.isArray(raw) ? raw : [raw ?? ''];
    const session = lines.find((l) => l.startsWith('ft.session_token='));
    expect(session).toBeDefined();
    expect(session).toMatch(/;\s*HttpOnly/i);
    expect(session).toMatch(/;\s*SameSite=Lax/i);
    expect(session).not.toMatch(/;\s*Secure/i);

    const meRes = await me({ jar });
    expect(meRes.statusCode).toBe(200);
    const body = meResponseSchema.parse(meRes.json());
    expect(body.user).toMatchObject({ name: 'Ann Example', email, twoFactorEnabled: false });
  });

  it('answers /me without a session with 401 UNAUTHENTICATED', async () => {
    const res = await me();
    expect(res.statusCode).toBe(401);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a wrong password without revealing whether the email exists', async () => {
    const { email } = await signUp(app);
    const wrong = await signIn(app, { email, password: 'not the password' });
    const unknown = await signIn(app, { email: uniqueEmail(), password: 'not the password' });
    expect(wrong.res.statusCode).toBe(401);
    expect(unknown.res.statusCode).toBe(401);
    expect(wrong.res.json().code).toBeDefined();
    expect(wrong.res.json()).toEqual(unknown.res.json());
    expect(wrong.jar.has('ft.session_token')).toBe(false);
  });

  it('signs out so /me is 401 again', async () => {
    const { jar } = await signUp(app);
    expect((await call(app, 'POST', '/api/auth/sign-out', { jar })).statusCode).toBe(200);
    expect(jar.has('ft.session_token')).toBe(false);
    expect((await me({ jar })).statusCode).toBe(401);
  });

  it('stores the password as argon2id', async () => {
    const { userId } = await signUp(app);
    const [row] = await deps.db
      .select({ password: accounts.password })
      .from(accounts)
      .where(eq(accounts.userId, userId));
    expect(row?.password).toMatch(/^\$argon2id\$/);
  });

  it('changes the password; the old one stops working', async () => {
    const { jar, email } = await signUp(app);
    const newPassword = 'a brand new passphrase';
    const res = await call(app, 'POST', '/api/auth/change-password', {
      jar,
      body: { currentPassword: TEST_PASSWORD, newPassword },
    });
    expect(res.statusCode).toBe(200);
    expect((await signIn(app, { email, password: TEST_PASSWORD })).res.statusCode).toBe(401);
    expect((await signIn(app, { email, password: newPassword })).res.statusCode).toBe(200);
  });

  it('refuses to change the password with a wrong current password', async () => {
    const { jar, email } = await signUp(app);
    const res = await call(app, 'POST', '/api/auth/change-password', {
      jar,
      body: { currentPassword: 'not the password', newPassword: 'a brand new passphrase' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((await signIn(app, { email, password: TEST_PASSWORD })).res.statusCode).toBe(200);
  });

  it("rejects a sign-in from another origin with Better Auth's origin check", async () => {
    const { email } = await signUp(app);
    const res = await call(app, 'POST', '/api/auth/sign-in/email', {
      body: { email, password: TEST_PASSWORD },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('Better Auth two-factor', () => {
  it('requires a TOTP code after sign-in once 2FA is on', async () => {
    const { jar, email, password } = await signUp(app);
    const { rawSecret } = await enableTwoFactor(app, jar, password);

    const pending = await signIn(app, { email, password });
    expect(pending.res.statusCode).toBe(200);
    expect(pending.res.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await me({ jar: pending.jar })).statusCode).toBe(401);

    const verified = await call(app, 'POST', '/api/auth/two-factor/verify-totp', {
      jar: pending.jar,
      body: { code: await totpNow(rawSecret) },
    });
    expect(verified.statusCode).toBe(200);
    const meRes = await me({ jar: pending.jar });
    expect(meRes.statusCode).toBe(200);
    expect(meResponseSchema.parse(meRes.json()).user.twoFactorEnabled).toBe(true);
  });

  it('issues 8 backup codes, each usable once', async () => {
    const { jar, email, password } = await signUp(app);
    const { backupCodes } = await enableTwoFactor(app, jar, password);
    expect(backupCodes).toHaveLength(8);
    const code = backupCodes[0]!;

    const first = await signIn(app, { email, password });
    const ok = await call(app, 'POST', '/api/auth/two-factor/verify-backup-code', {
      jar: first.jar,
      body: { code },
    });
    expect(ok.statusCode).toBe(200);
    expect((await me({ jar: first.jar })).statusCode).toBe(200);

    const second = await signIn(app, { email, password });
    const reused = await call(app, 'POST', '/api/auth/two-factor/verify-backup-code', {
      jar: second.jar,
      body: { code },
    });
    expect(reused.statusCode).toBeGreaterThanOrEqual(400);
    expect((await me({ jar: second.jar })).statusCode).toBe(401);
  });
});

describe('global rate limit on real routes', () => {
  it.each(['/api/v1/me', '/api/auth/get-session'])('limits %s', async (url) => {
    const limited = buildApp({ config, checks: deps.checks, auth, rateLimitMax: 3 });
    try {
      for (let i = 0; i < 3; i++) {
        expect((await call(limited, 'GET', url)).statusCode).not.toBe(429);
      }
      const res = await call(limited, 'GET', url);
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
