import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  CookieJar,
  enableTwoFactor,
  signIn,
  signUp,
  totpNow,
  uniqueEmail,
} from '../../test/auth-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { createResetLink } from '../auth/reset-links.js';
import { loadConfig } from '../config.js';
import { accounts, twoFactors } from '../db/schema.js';
import { createDeps } from '../deps.js';

const config = { ...loadConfig(), TRUST_PROXY: 1 };
const deps = createDeps(config);
// Better Auth's limiter is off so sign-ins in these tests are never throttled; our own
// per-route limits are what is under test.
const auth = createAuth({ config, db: deps.db, rateLimitEnabled: false });
const NEW_PASSWORD = 'A fresh reset passphrase1';
const INVALID = { code: 'INVALID_RESET', message: 'Email or code is incorrect' };

// A fresh app per test gives each one its own @fastify/rate-limit counters.
let app: ReturnType<typeof buildApp>;
const newApp = () => buildApp({ config, checks: deps.checks, auth, db: deps.db });
beforeEach(() => {
  app = newApp();
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await deps.close();
});

let ipCounter = 0;
/** A distinct client IP (behind one trusted proxy) so per-IP limits don't leak between calls. */
const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`;

const resetTotp = (
  body: Record<string, unknown>,
  { target = app, ip = nextIp(), headers = {} as Record<string, string | undefined> } = {},
) =>
  call(target, 'POST', '/api/v1/password-reset/totp', {
    body,
    headers: { 'x-forwarded-for': ip, ...headers },
  });

const me = (jar: CookieJar) => call(app, 'GET', '/api/v1/me', { jar });

async function userWith2fa() {
  const user = await signUp(app);
  const { rawSecret, backupCodes } = await enableTwoFactor(app, user.jar, user.password);
  return { ...user, rawSecret, backupCodes };
}

async function twoFactorRow(userId: string) {
  const [row] = await deps.db.select().from(twoFactors).where(eq(twoFactors.userId, userId));
  return row!;
}

function wrongCode(good: string) {
  return good === '000000' ? '111111' : '000000';
}

describe('POST /api/v1/password-reset/totp', () => {
  it('resets with the current authenticator code and revokes old sessions', async () => {
    const { jar, email, password, userId, rawSecret } = await userWith2fa();
    const res = await resetTotp({
      email,
      code: await totpNow(rawSecret),
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(204);
    expect((await me(jar)).statusCode).toBe(401);
    const [account] = await deps.db
      .select({ password: accounts.password })
      .from(accounts)
      .where(eq(accounts.userId, userId));
    expect(account?.password).toMatch(/^\$argon2id\$/);

    expect((await signIn(app, { email, password })).res.statusCode).toBe(401);
    const next = await signIn(app, { email, password: NEW_PASSWORD });
    expect(next.res.statusCode).toBe(200);
    expect(next.res.json()).toMatchObject({ twoFactorRedirect: true });
  });

  it('accepts the code with spaces and the email in any case', async () => {
    const { email, rawSecret } = await userWith2fa();
    const code = await totpNow(rawSecret);
    const res = await resetTotp({
      email: `  ${email.toUpperCase()} `,
      code: `${code.slice(0, 3)} ${code.slice(3)}`,
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(204);
  });

  it("consumes a recovery code in Better Auth's own format", async () => {
    const { email, backupCodes } = await userWith2fa();
    const [code, other] = backupCodes as [string, string];
    expect((await resetTotp({ email, code, newPassword: NEW_PASSWORD })).statusCode).toBe(204);

    const again = await resetTotp({ email, code, newPassword: 'Yet another passphrase1' });
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toEqual(INVALID);

    // Better Auth rejects the spent code too, and still accepts an unspent one.
    const pending = await signIn(app, { email, password: NEW_PASSWORD });
    const reused = await call(app, 'POST', '/api/auth/two-factor/verify-backup-code', {
      jar: pending.jar,
      body: { code },
    });
    expect(reused.statusCode).toBe(401);
    const fresh = await call(app, 'POST', '/api/auth/two-factor/verify-backup-code', {
      jar: pending.jar,
      body: { code: other },
    });
    expect(fresh.statusCode).toBe(200);
    expect((await me(pending.jar)).statusCode).toBe(200);
  });

  it('gives the same answer for a wrong code, an unknown email and a user without 2FA', async () => {
    const { email, rawSecret } = await userWith2fa();
    const plain = await signUp(app);
    const wrong = await resetTotp({
      email,
      code: wrongCode(await totpNow(rawSecret)),
      newPassword: NEW_PASSWORD,
    });
    const unknown = await resetTotp({
      email: uniqueEmail(),
      code: '123456',
      newPassword: NEW_PASSWORD,
    });
    const no2fa = await resetTotp({
      email: plain.email,
      code: '123456',
      newPassword: NEW_PASSWORD,
    });
    for (const res of [wrong, unknown, no2fa]) {
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: INVALID });
    }
    expect(
      (await signIn(app, { email: plain.email, password: plain.password })).res.statusCode,
    ).toBe(200);
  });

  it('blocks the 6th attempt for one email in 15 minutes, even with a correct code', async () => {
    const { email, rawSecret } = await userWith2fa();
    for (let i = 0; i < 5; i++) {
      const res = await resetTotp({ email, code: 'aaaaa-bbbbb', newPassword: NEW_PASSWORD });
      expect(res.statusCode).toBe(400);
    }
    const res = await resetTotp({
      email: email.toUpperCase(),
      code: await totpNow(rawSecret),
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it.each([
    ['IPv6 addresses in one /64', '2001:db8:1:2::1', '2001:db8:1:2:ffff:ffff:ffff:ffff'],
    ['an IPv4-mapped address and its IPv4 form', '::ffff:203.0.113.99', '203.0.113.99'],
  ])('counts %s as one client', async (_label, first, second) => {
    for (let i = 0; i < 20; i++) {
      const res = await resetTotp(
        { email: uniqueEmail(), code: '123456', newPassword: NEW_PASSWORD },
        { ip: i % 2 === 0 ? first : second },
      );
      expect(res.statusCode).toBe(400);
    }
    const res = await resetTotp(
      { email: uniqueEmail(), code: '123456', newPassword: NEW_PASSWORD },
      { ip: second },
    );
    expect(res.statusCode).toBe(429);
  });

  it('spends a recovery code once under 4 concurrent resets', async () => {
    const { email, backupCodes } = await userWith2fa();
    const code = backupCodes[0]!;
    const results = await Promise.all(
      [0, 1, 2, 3].map(() => resetTotp({ email, code, newPassword: NEW_PASSWORD })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 400, 400, 400]);
  });

  it('spends outstanding reset links on success', async () => {
    const { email, userId, rawSecret } = await userWith2fa();
    const { token } = await createResetLink(deps.db, { userId, createdByUserId: null });
    const ok = await resetTotp({
      email,
      code: await totpNow(rawSecret),
      newPassword: NEW_PASSWORD,
    });
    expect(ok.statusCode).toBe(204);
    const link = await call(app, 'POST', '/api/v1/password-reset/link', {
      body: { token, newPassword: 'An attacker passphrase1' },
    });
    expect(link.statusCode).toBe(400);
    expect(link.json()).toEqual({ error: INVALID });
  });

  it('caps one IP at 20 attempts in 15 minutes across emails', async () => {
    const ip = '203.0.113.77';
    for (let i = 0; i < 20; i++) {
      const res = await resetTotp(
        { email: uniqueEmail(), code: '123456', newPassword: NEW_PASSWORD },
        { ip },
      );
      expect(res.statusCode).toBe(400);
    }
    const res = await resetTotp(
      { email: uniqueEmail(), code: '123456', newPassword: NEW_PASSWORD },
      { ip },
    );
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('rejects a short new password with VALIDATION', async () => {
    const res = await resetTotp({ email: uniqueEmail(), code: '123456', newPassword: 'short' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it.each([
    ['a foreign Origin', 'https://evil.example'],
    ['no Origin', undefined],
  ])('rejects %s with 403', async (_label, origin) => {
    const { email, rawSecret } = await userWith2fa();
    const res = await resetTotp(
      { email, code: await totpNow(rawSecret), newPassword: NEW_PASSWORD },
      { headers: { origin } },
    );
    expect(res.statusCode).toBe(403);
    expect((await signIn(app, { email, password: NEW_PASSWORD })).res.statusCode).toBe(401);
  });
});

describe('password reset and the 2FA account lockout', () => {
  /** Fails verify-totp n times during one sign-in, feeding Better Auth's lockout counter. */
  async function failSignIn2fa(email: string, password: string, bad: string, n: number) {
    const pending = await signIn(app, { email, password });
    for (let i = 0; i < n; i++) {
      const res = await call(app, 'POST', '/api/auth/two-factor/verify-totp', {
        jar: pending.jar,
        body: { code: bad },
      });
      expect(res.statusCode).toBe(401);
    }
  }

  it('5 failed resets do NOT lock sign-in 2FA', async () => {
    const { email, password, userId, rawSecret } = await userWith2fa();
    const bad = wrongCode(await totpNow(rawSecret));
    for (let i = 0; i < 5; i++) {
      expect((await resetTotp({ email, code: bad, newPassword: NEW_PASSWORD })).statusCode).toBe(
        400,
      );
    }
    const row = await twoFactorRow(userId);
    expect(row.failedVerificationCount).toBe(0);
    expect(row.lockedUntil).toBeNull();

    const pending = await signIn(app, { email, password });
    const verify = await call(app, 'POST', '/api/auth/two-factor/verify-totp', {
      jar: pending.jar,
      body: { code: await totpNow(rawSecret) },
    });
    expect(verify.statusCode).toBe(200);
    expect((await me(pending.jar)).statusCode).toBe(200);
  });

  it('an existing sign-in lock blocks the reset, even with a correct code', async () => {
    const { email, password, userId, rawSecret } = await userWith2fa();
    await failSignIn2fa(email, password, wrongCode(await totpNow(rawSecret)), 5);
    expect((await twoFactorRow(userId)).lockedUntil).not.toBeNull();

    const res = await resetTotp({
      email,
      code: await totpNow(rawSecret),
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: INVALID });
    expect((await signIn(app, { email, password: NEW_PASSWORD })).res.statusCode).toBe(401);
  });

  it('clears the sign-in failure count after a successful reset', async () => {
    const { email, password, userId, rawSecret } = await userWith2fa();
    await failSignIn2fa(email, password, wrongCode(await totpNow(rawSecret)), 3);
    expect((await twoFactorRow(userId)).failedVerificationCount).toBe(3);
    const ok = await resetTotp({
      email,
      code: await totpNow(rawSecret),
      newPassword: NEW_PASSWORD,
    });
    expect(ok.statusCode).toBe(204);
    const row = await twoFactorRow(userId);
    expect(row.failedVerificationCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it('leaves the sign-in failure count untouched when a reset fails', async () => {
    const { email, password, userId, rawSecret } = await userWith2fa();
    const bad = wrongCode(await totpNow(rawSecret));
    await failSignIn2fa(email, password, bad, 2);
    expect((await resetTotp({ email, code: bad, newPassword: NEW_PASSWORD })).statusCode).toBe(400);
    expect((await twoFactorRow(userId)).failedVerificationCount).toBe(2);
  });

  it('accepts a correct code once an earlier lock has expired', async () => {
    const { email, userId, rawSecret } = await userWith2fa();
    await deps.db
      .update(twoFactors)
      .set({ failedVerificationCount: 5, lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(twoFactors.userId, userId));
    const ok = await resetTotp({
      email,
      code: await totpNow(rawSecret),
      newPassword: NEW_PASSWORD,
    });
    expect(ok.statusCode).toBe(204);
    const row = await twoFactorRow(userId);
    expect(row.failedVerificationCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });
});
