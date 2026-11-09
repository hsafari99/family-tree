import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signIn, signUp } from '../../test/auth-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { resetLinks } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';
import { consumeResetLink, createResetLink, hashResetToken } from './reset-links.js';

const config = { ...loadConfig(), TRUST_PROXY: 1 };
const deps = createDeps(config);
const auth = createAuth({ config, db: deps.db, rateLimitEnabled: false });
const NEW_PASSWORD = 'a fresh link passphrase';
const INVALID = { error: { code: 'INVALID_RESET', message: 'Email or code is incorrect' } };

let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  app = buildApp({ config, checks: deps.checks, auth, db: deps.db });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await deps.close();
});

let ipCounter = 0;
const redeem = (token: string, { ip = `198.51.100.${(ipCounter++ % 250) + 1}` } = {}) =>
  call(app, 'POST', '/api/v1/password-reset/link', {
    body: { token, newPassword: NEW_PASSWORD },
    headers: { 'x-forwarded-for': ip },
  });

const randomToken = () => randomBytes(32).toString('base64url');

describe('reset links', () => {
  it('creates a long random token and stores only its sha256', async () => {
    const { userId } = await signUp(app);
    const { token, expiresAt } = await createResetLink(deps.db, {
      userId,
      createdByUserId: null,
      ttlHours: 24,
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);

    const rows = await deps.db.select().from(resetLinks).where(eq(resetLinks.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashResetToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('redeems a link once: password changes, sessions are revoked, used_at is set', async () => {
    const { jar, email, password, userId } = await signUp(app);
    const { token } = await createResetLink(deps.db, { userId, createdByUserId: null });

    expect((await redeem(token)).statusCode).toBe(204);
    expect((await call(app, 'GET', '/api/v1/me', { jar })).statusCode).toBe(401);
    expect((await signIn(app, { email, password })).res.statusCode).toBe(401);
    expect((await signIn(app, { email, password: NEW_PASSWORD })).res.statusCode).toBe(200);
    const [row] = await deps.db.select().from(resetLinks).where(eq(resetLinks.userId, userId));
    expect(row!.usedAt).toBeInstanceOf(Date);

    const again = await redeem(token);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual(INVALID);
  });

  it('rejects an expired link', async () => {
    const { userId } = await signUp(app);
    const token = randomToken();
    await deps.db.insert(resetLinks).values({
      tokenHash: hashResetToken(token),
      userId,
      createdByUserId: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await redeem(token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(INVALID);
  });

  it('rejects a random token', async () => {
    const res = await redeem(randomToken());
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(INVALID);
  });

  it('lets exactly one of several concurrent redemptions win', async () => {
    const { userId } = await signUp(app);
    const { token } = await createResetLink(deps.db, { userId, createdByUserId: null });
    // All requests start before any is awaited, so they race for the same row.
    const pending = [redeem(token), redeem(token), redeem(token), redeem(token)];
    const results = await Promise.all(pending);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 400, 400, 400]);
    expect(await consumeResetLink(deps.db, token)).toBeNull();
  });

  it("spends the user's other outstanding links when one is redeemed", async () => {
    const { userId } = await signUp(app);
    const first = await createResetLink(deps.db, { userId, createdByUserId: null });
    const second = await createResetLink(deps.db, { userId, createdByUserId: null });
    const other = await signUp(app);
    const unrelated = await createResetLink(deps.db, {
      userId: other.userId,
      createdByUserId: null,
    });

    expect((await redeem(first.token)).statusCode).toBe(204);
    const stale = await redeem(second.token);
    expect(stale.statusCode).toBe(400);
    expect(stale.json()).toEqual(INVALID);
    expect((await redeem(unrelated.token)).statusCode).toBe(204);
  });

  it('limits one IP to 10 redemptions in 15 minutes', async () => {
    const ip = '203.0.113.88';
    for (let i = 0; i < 10; i++) {
      expect((await redeem(randomToken(), { ip })).statusCode).toBe(400);
    }
    const res = await redeem(randomToken(), { ip });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('rejects a foreign Origin with 403', async () => {
    const { userId } = await signUp(app);
    const { token } = await createResetLink(deps.db, { userId, createdByUserId: null });
    const res = await call(app, 'POST', '/api/v1/password-reset/link', {
      body: { token, newPassword: NEW_PASSWORD },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect((await redeem(token)).statusCode).toBe(204);
  });
});
