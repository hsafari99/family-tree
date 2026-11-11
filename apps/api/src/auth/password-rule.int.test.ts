import { PASSWORD_CLASSES_MESSAGE } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signIn, signUp, TEST_PASSWORD, uniqueEmail } from '../../test/auth-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { accounts } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';
import { hashPassword } from './password.js';
import { createResetLink } from './reset-links.js';

const config = { ...loadConfig(), TRUST_PROXY: 1 };
const deps = createDeps(config);
const auth = createAuth({ config, db: deps.db, rateLimitEnabled: false });

// Long enough, but no capital, number or symbol: only the character rule refuses it.
const WEAK = 'x'.repeat(12);

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

const weakPassword = { code: 'WEAK_PASSWORD', message: PASSWORD_CLASSES_MESSAGE };

describe('the new-password rule', () => {
  it('sign-up refuses a weak password with 400 and a fixed message', async () => {
    const res = await call(app, 'POST', '/api/auth/sign-up/email', {
      body: { email: uniqueEmail(), password: WEAK, name: 'Weak' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject(weakPassword);
  });

  it('change-password refuses a weak new password and keeps the old one', async () => {
    const { jar, email } = await signUp(app);
    const res = await call(app, 'POST', '/api/auth/change-password', {
      jar,
      body: { currentPassword: TEST_PASSWORD, newPassword: WEAK },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject(weakPassword);
    expect((await signIn(app, { email, password: TEST_PASSWORD })).res.statusCode).toBe(200);
  });

  it('Better Auth’s own reset endpoint refuses a weak password too', async () => {
    const res = await call(app, 'POST', '/api/auth/reset-password', {
      body: { newPassword: WEAK, token: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject(weakPassword);
  });

  it('setting a first password (Google accounts) refuses a weak one with 400', async () => {
    const { jar } = await signUp(app);
    const res = await call(app, 'POST', '/api/v1/account/password', {
      jar,
      body: { newPassword: WEAK },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { newPassword: [PASSWORD_CLASSES_MESSAGE] },
    });
  });

  it('a reset link refuses a weak password with 400 and leaves the link unused', async () => {
    const { userId, email } = await signUp(app);
    const { token } = await createResetLink(deps.db, {
      userId,
      createdByUserId: null,
      ttlHours: 1,
    });
    const res = await call(app, 'POST', '/api/v1/password-reset/link', {
      body: { token, newPassword: WEAK },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { newPassword: [PASSWORD_CLASSES_MESSAGE] },
    });
    expect((await signIn(app, { email, password: TEST_PASSWORD })).res.statusCode).toBe(200);
  });

  it('a reset with a code refuses a weak password with 400', async () => {
    const res = await call(app, 'POST', '/api/v1/password-reset/totp', {
      body: { email: uniqueEmail(), code: '123456', newPassword: WEAK },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { newPassword: [PASSWORD_CLASSES_MESSAGE] },
    });
  });

  it('sign-in never checks the rule: an existing weak password keeps working', async () => {
    const { userId, email } = await signUp(app);
    await deps.db
      .update(accounts)
      .set({ password: await hashPassword(WEAK) })
      .where(eq(accounts.userId, userId));
    expect((await signIn(app, { email, password: WEAK })).res.statusCode).toBe(200);
  });
});
