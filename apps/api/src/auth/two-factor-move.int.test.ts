import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { eq, inArray } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  CookieJar,
  signIn,
  signUp,
  TEST_PASSWORD,
  totpNow,
} from '../../test/auth-helpers.js';
import { googleProfile, googleSignIn, TEST_GOOGLE } from '../../test/google-helpers.js';
import {
  addGrant,
  addMember,
  addPerson,
  ownerWithTree,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { sessions, twoFactorMoves, twoFactors, users } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';
import {
  encryptRecoveryCodes,
  encryptTotpSecret,
  newRecoveryCodes,
  newTotpSecret,
  purgeExpiredMoves,
} from './two-factor-move.js';

const config = { ...loadConfig(), google: TEST_GOOGLE };
const deps = createDeps(config);
const { db } = deps;
const auth = createAuth({ config, db, rateLimitEnabled: false });

let app: ReturnType<typeof buildApp>;
let logLines: string[] = [];
beforeEach(() => {
  logLines = [];
  app = buildApp({
    config: { ...config, LOG_LEVEL: 'info' },
    checks: deps.checks,
    auth,
    db,
    logStream: { write: (line) => void logLines.push(line) },
  });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await deps.close();
});

const MOVE = '/api/v1/account/two-factor/move';
const start = (jar: CookieJar, body: Record<string, unknown>) =>
  call(app, 'POST', `${MOVE}/start`, { jar, body });
const confirm = (jar: CookieJar, code: string) =>
  call(app, 'POST', `${MOVE}/confirm`, { jar, body: { code } });
const cancel = (jar: CookieJar) => call(app, 'POST', `${MOVE}/cancel`, { jar });
const errorCode = (res: { json(): unknown }) =>
  (res.json() as { error: { code: string } }).error.code;

const rawFromUri = (totpURI: string) =>
  new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get('secret')!));

/** A 6-digit code that is not valid for `raw` right now (nor one step either side). */
async function wrongCodeFor(raw: string): Promise<string> {
  const otp = createOTP(raw);
  // A random start, so the code is unlikely to turn up in a log line by accident.
  for (let n = 100_000 + Math.floor(Math.random() * 800_000); ; n++) {
    const code = String(n);
    if (!(await otp.verify(code, { window: 1 }))) return code;
  }
}

/** Starts a move with the password and a current code; returns the new phone's raw secret. */
async function startWithTotp(user: { jar: CookieJar; rawSecret: string }) {
  const res = await start(user.jar, {
    password: TEST_PASSWORD,
    code: await totpNow(user.rawSecret),
  });
  expect(res.statusCode).toBe(200);
  return rawFromUri(res.json().totpURI as string);
}

/** A fresh password sign-in, finished with an authenticator code. */
async function signInWithTotp(email: string, code: string) {
  const { jar, res } = await signIn(app, { email, password: TEST_PASSWORD });
  expect(res.json().twoFactorRedirect).toBe(true);
  const verify = await call(app, 'POST', '/api/auth/two-factor/verify-totp', {
    jar,
    body: { code },
  });
  return { jar, verify };
}

async function signInWithRecoveryCode(email: string, code: string) {
  const { jar } = await signIn(app, { email, password: TEST_PASSWORD });
  return call(app, 'POST', '/api/auth/two-factor/verify-backup-code', { jar, body: { code } });
}

/** A jar holding only the trust-device cookie from `res` (or the one already in `prev`). */
function trustCookieJar(res: LightMyRequestResponse, prev?: CookieJar): CookieJar {
  const raw = res.headers['set-cookie'];
  const lines = (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).filter((l) =>
    l.includes('trust_device='),
  );
  if (lines.length === 0 && prev) return prev;
  expect(lines).toHaveLength(1);
  return new CookieJar().store({ headers: { 'set-cookie': lines } } as LightMyRequestResponse);
}

const pendingFor = (userId: string) =>
  db.select().from(twoFactorMoves).where(eq(twoFactorMoves.userId, userId));

async function twoFactorState(userId: string) {
  const [user] = await db
    .select({ enabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, userId));
  const [tf] = await db.select().from(twoFactors).where(eq(twoFactors.userId, userId));
  return { enabled: user?.enabled, verified: tf?.verified, secret: tf?.secret };
}

describe('moving 2FA to a new phone', () => {
  it('swaps in the new secret: the old phone stops working and the new one works', async () => {
    const user = await userWith2fa(app);
    const before = await twoFactorState(user.userId);
    const res = await start(user.jar, {
      password: TEST_PASSWORD,
      code: await totpNow(user.rawSecret),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { totpURI } = res.json() as { totpURI: string };
    expect(new URL(totpURI).searchParams.get('issuer')).toBe('Family Tree');
    const newRaw = rawFromUri(totpURI);
    expect(newRaw).not.toBe(user.rawSecret);

    // Pending: stored encrypted, the real secret untouched, 2FA on.
    const [pending] = await pendingFor(user.userId);
    expect(pending!.secret).not.toContain(newRaw);
    expect(pending!.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(pending!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(await twoFactorState(user.userId)).toEqual(before);

    const done = await confirm(user.jar, await totpNow(newRaw));
    expect(done.statusCode).toBe(200);
    expect(done.headers['cache-control']).toBe('no-store');
    const { backupCodes } = done.json() as { backupCodes: string[] };
    expect(backupCodes).toHaveLength(8);
    expect(await pendingFor(user.userId)).toHaveLength(0);
    const after = await twoFactorState(user.userId);
    expect(after).toMatchObject({ enabled: true, verified: true });
    expect(after.secret).not.toBe(before.secret);

    const me = (await call(app, 'GET', '/api/v1/me', { jar: user.jar })).json().user;
    expect(me.twoFactorEnabled).toBe(true);

    const old = await signInWithTotp(user.email, await totpNow(user.rawSecret));
    expect(old.verify.statusCode).toBe(401);
    const fresh = await signInWithTotp(user.email, await totpNow(newRaw));
    expect(fresh.verify.statusCode).toBe(200);
  });

  it('keeps the old phone working after a wrong code, and lets the user try again', async () => {
    const user = await userWith2fa(app);
    const newRaw = await startWithTotp(user);
    const wrong = await confirm(user.jar, await wrongCodeFor(newRaw));
    expect(wrong.statusCode).toBe(400);
    expect(errorCode(wrong)).toBe('INVALID_CODE');
    expect(await pendingFor(user.userId)).toHaveLength(1);
    expect(
      (await signInWithTotp(user.email, await totpNow(user.rawSecret))).verify.statusCode,
    ).toBe(200);

    expect((await confirm(user.jar, await totpNow(newRaw))).statusCode).toBe(200);
  });

  it('refuses an expired pending secret and drops it; the old phone still works', async () => {
    const user = await userWith2fa(app);
    const newRaw = await startWithTotp(user);
    await db
      .update(twoFactorMoves)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(twoFactorMoves.userId, user.userId));
    const res = await confirm(user.jar, await totpNow(newRaw));
    expect(res.statusCode).toBe(410);
    expect(errorCode(res)).toBe('MOVE_EXPIRED');
    expect(await pendingFor(user.userId)).toHaveLength(0);
    expect(
      (await signInWithTotp(user.email, await totpNow(user.rawSecret))).verify.statusCode,
    ).toBe(200);
  });

  it('starts with a recovery code when the old phone is lost, and spends that code', async () => {
    const user = await userWith2fa(app);
    const [code, other] = user.backupCodes;
    const res = await start(user.jar, { password: TEST_PASSWORD, code });
    expect(res.statusCode).toBe(200);
    const again = await start(user.jar, { password: TEST_PASSWORD, code });
    expect(errorCode(again)).toBe('INVALID_CODE');
    const newRaw = rawFromUri(
      (await start(user.jar, { password: TEST_PASSWORD, code: other })).json().totpURI,
    );
    expect((await confirm(user.jar, await totpNow(newRaw))).statusCode).toBe(200);
  });

  it('replaces the recovery codes: old ones stop working, new ones work', async () => {
    const user = await userWith2fa(app);
    const newRaw = await startWithTotp(user);
    const { backupCodes } = (await confirm(user.jar, await totpNow(newRaw))).json();
    expect(backupCodes).not.toContain(user.backupCodes[1]);
    expect((await signInWithRecoveryCode(user.email, user.backupCodes[1]!)).statusCode).toBe(401);
    expect((await signInWithRecoveryCode(user.email, backupCodes[0])).statusCode).toBe(200);
    // The reset-with-code route reads the same codes.
    const reset = await call(app, 'POST', '/api/v1/password-reset/totp', {
      body: { email: user.email, code: user.backupCodes[2], newPassword: 'A brand new password1' },
    });
    expect(reset.statusCode).toBe(400);
  });

  it('signs out every other session, and keeps this one', async () => {
    const user = await userWith2fa(app);
    const elsewhere = await signInWithTotp(user.email, await totpNow(user.rawSecret));
    expect(elsewhere.verify.statusCode).toBe(200);
    const newRaw = await startWithTotp(user);
    expect((await confirm(user.jar, await totpNow(newRaw))).statusCode).toBe(200);
    expect((await call(app, 'GET', '/api/v1/me', { jar: elsewhere.jar })).statusCode).toBe(401);
    expect((await call(app, 'GET', '/api/v1/me', { jar: user.jar })).statusCode).toBe(200);
    expect(await db.select().from(sessions).where(eq(sessions.userId, user.userId))).toHaveLength(
      1,
    );
  });

  it('never turns 2FA off: stewards and owners keep their powers at every step', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const steward = await userWith2fa(app, 'Sam');
    await addMember(db, treeId, steward.userId, 'viewer', owner.userId);
    const anchor = await addPerson(db, treeId, 'Anchor');
    await addGrant(db, treeId, steward.userId, anchor.id, owner.userId);

    const stewardCanAdd = async () =>
      (
        await call(app, 'POST', `/api/v1/trees/${treeId}/persons`, {
          jar: steward.jar,
          body: { person: { givenName: 'Kid' }, attach: { to: anchor.id, as: 'child' } },
        })
      ).statusCode;
    const stewardActive = async () =>
      (await call(app, 'GET', `/api/v1/trees/${treeId}/stewards`, { jar: owner.jar }))
        .json()
        .stewards.find((s: { userId: string }) => s.userId === steward.userId).active;
    const ownerCanCreate = async () =>
      (
        await call(app, 'POST', '/api/v1/trees', {
          jar: owner.jar,
          body: { name: 'Another', person: { givenName: 'Olive', surname: 'Owner' } },
        })
      ).statusCode;
    const check = async () => {
      expect(await stewardCanAdd()).toBe(201);
      expect(await stewardActive()).toBe(true);
      expect((await twoFactorState(steward.userId)).enabled).toBe(true);
    };

    await check();
    const newRaw = await startWithTotp(steward);
    await check();
    await confirm(steward.jar, await wrongCodeFor(newRaw));
    await check();
    expect((await confirm(steward.jar, await totpNow(newRaw))).statusCode).toBe(200);
    await check();

    const ownerRaw = await startWithTotp(owner);
    expect(await ownerCanCreate()).toBe(201);
    expect((await confirm(owner.jar, await totpNow(ownerRaw))).statusCode).toBe(200);
    expect(await ownerCanCreate()).toBe(201);
  });

  it('lets another start replace the pending secret: one per user', async () => {
    const user = await userWith2fa(app);
    const first = await startWithTotp(user);
    const second = rawFromUri(
      (await start(user.jar, { password: TEST_PASSWORD, code: user.backupCodes[0] })).json()
        .totpURI,
    );
    expect(await pendingFor(user.userId)).toHaveLength(1);
    const stale = await confirm(user.jar, await totpNow(first));
    expect(errorCode(stale)).toBe('INVALID_CODE');
    expect((await confirm(user.jar, await totpNow(second))).statusCode).toBe(200);
  });

  it('cancels: the pending secret is gone and the old phone still works', async () => {
    const user = await userWith2fa(app);
    const newRaw = await startWithTotp(user);
    expect((await cancel(user.jar)).statusCode).toBe(204);
    expect(await pendingFor(user.userId)).toHaveLength(0);
    const res = await confirm(user.jar, await totpNow(newRaw));
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('MOVE_NOT_STARTED');
    expect((await cancel(user.jar)).statusCode).toBe(204);
    expect(
      (await signInWithTotp(user.email, await totpNow(user.rawSecret))).verify.statusCode,
    ).toBe(200);
  });

  it('forgets trusted devices: a trust-device cookie no longer skips the code', async () => {
    const user = await userWith2fa(app);
    // A sign-in on another browser that ticks "trust this device".
    const { jar: browser } = await signIn(app, { email: user.email, password: TEST_PASSWORD });
    const verify = await call(app, 'POST', '/api/auth/two-factor/verify-totp', {
      jar: browser,
      body: { code: await totpNow(user.rawSecret), trustDevice: true },
    });
    expect(verify.statusCode).toBe(200);
    const trusted = trustCookieJar(verify);
    // Before the move, the trust cookie skips the code.
    const skipped = await call(app, 'POST', '/api/auth/sign-in/email', {
      jar: trusted,
      body: { email: user.email, password: TEST_PASSWORD },
    });
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json().twoFactorRedirect).toBeUndefined();
    const latest = trustCookieJar(skipped, trusted);

    const newRaw = await startWithTotp(user);
    expect((await confirm(user.jar, await totpNow(newRaw))).statusCode).toBe(200);

    const after = await call(app, 'POST', '/api/auth/sign-in/email', {
      jar: latest,
      body: { email: user.email, password: TEST_PASSWORD },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().twoFactorRedirect).toBe(true);
  });

  it('drops the pending secret when 2FA was turned off before confirming', async () => {
    const user = await userWith2fa(app);
    const newRaw = await startWithTotp(user);
    await db.delete(twoFactors).where(eq(twoFactors.userId, user.userId));
    const res = await confirm(user.jar, await totpNow(newRaw));
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('MOVE_NOT_STARTED');
    expect(await pendingFor(user.userId)).toHaveLength(0);
  });
});

describe('expired pending moves', () => {
  const expire = (userId: string) =>
    db
      .update(twoFactorMoves)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(twoFactorMoves.userId, userId));

  it("are deleted when anyone starts a move, without touching others' live ones", async () => {
    const ann = await userWith2fa(app, 'Ann');
    const bob = await userWith2fa(app, 'Bob');
    const cat = await userWith2fa(app, 'Cat');
    await startWithTotp(ann);
    await startWithTotp(bob);
    await expire(ann.userId);
    await startWithTotp(cat);
    expect(await pendingFor(ann.userId)).toHaveLength(0);
    expect(await pendingFor(bob.userId)).toHaveLength(1);
    expect(await pendingFor(cat.userId)).toHaveLength(1);
  });

  it('are deleted by purgeExpiredMoves, which keeps live ones', async () => {
    const ann = await userWith2fa(app, 'Ann');
    const bob = await userWith2fa(app, 'Bob');
    await startWithTotp(ann);
    await startWithTotp(bob);
    await expire(ann.userId);
    expect(await purgeExpiredMoves(db)).toBeGreaterThanOrEqual(1);
    const left = await db
      .select({ userId: twoFactorMoves.userId })
      .from(twoFactorMoves)
      .where(inArray(twoFactorMoves.userId, [ann.userId, bob.userId]));
    expect(left).toEqual([{ userId: bob.userId }]);
  });
});

describe('starting a move re-authenticates', () => {
  it('needs the password, then a current code', async () => {
    const user = await userWith2fa(app);
    const code = await totpNow(user.rawSecret);
    expect(errorCode(await start(user.jar, { code }))).toBe('PASSWORD_REQUIRED');
    expect(errorCode(await start(user.jar, { password: 'Not the password1', code }))).toBe(
      'INVALID_PASSWORD',
    );
    expect(errorCode(await start(user.jar, { password: TEST_PASSWORD }))).toBe(
      'TWO_FACTOR_CODE_REQUIRED',
    );
    const wrong = await start(user.jar, {
      password: TEST_PASSWORD,
      code: await wrongCodeFor(user.rawSecret),
    });
    expect(wrong.statusCode).toBe(400);
    expect(errorCode(wrong)).toBe('INVALID_CODE');
    expect(await pendingFor(user.userId)).toHaveLength(0);
  });

  it('is only for accounts with 2FA on, and only signed in', async () => {
    const plain = await signUp(app);
    const res = await start(plain.jar, { password: TEST_PASSWORD, code: '123456' });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('TWO_FACTOR_NOT_ENABLED');
    expect((await start(new CookieJar(), { password: TEST_PASSWORD })).statusCode).toBe(401);
    expect((await confirm(new CookieJar(), '123456')).statusCode).toBe(401);
    expect((await cancel(new CookieJar())).statusCode).toBe(401);
  });
});

describe('a Google-only account', () => {
  /** Signs in with Google, then gives the account verified 2FA directly. */
  async function googleOnlyWith2fa() {
    const profile = googleProfile();
    const { jar } = await googleSignIn(app, profile);
    const me = (await call(app, 'GET', '/api/v1/me', { jar })).json().user;
    expect(me.hasPassword).toBe(false);
    const key = (await auth.$context).secretConfig;
    const rawSecret = newTotpSecret();
    const backupCodes = newRecoveryCodes();
    await db.insert(twoFactors).values({
      userId: me.id,
      secret: await encryptTotpSecret(key, rawSecret),
      backupCodes: await encryptRecoveryCodes(key, backupCodes),
      verified: true,
    });
    await db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, me.id));
    return { jar, userId: me.id as string, rawSecret, backupCodes };
  }

  it('confirms with a recent sign-in instead of a password, plus a code', async () => {
    const user = await googleOnlyWith2fa();
    expect(errorCode(await start(user.jar, {}))).toBe('TWO_FACTOR_CODE_REQUIRED');
    const res = await start(user.jar, { code: await totpNow(user.rawSecret) });
    expect(res.statusCode).toBe(200);
    const newRaw = rawFromUri(res.json().totpURI);
    expect((await confirm(user.jar, await totpNow(newRaw))).statusCode).toBe(200);
  });

  it('needs a sign-in from the last 10 minutes', async () => {
    const user = await googleOnlyWith2fa();
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(sessions.userId, user.userId));
    const res = await start(user.jar, { code: user.backupCodes[0] });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('RECENT_SIGN_IN_REQUIRED');
    expect(await pendingFor(user.userId)).toHaveLength(0);
  });
});

describe('who can confirm', () => {
  it("refuses another user's code for someone else's pending secret", async () => {
    const ann = await userWith2fa(app, 'Ann');
    const bob = await userWith2fa(app, 'Bob');
    const bobBefore = await twoFactorState(bob.userId);
    const annRaw = await startWithTotp(ann);
    const res = await confirm(bob.jar, await totpNow(annRaw));
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('MOVE_NOT_STARTED');
    expect(await pendingFor(ann.userId)).toHaveLength(1);
    expect(await twoFactorState(bob.userId)).toEqual(bobBefore);
    expect((await signInWithTotp(bob.email, await totpNow(bob.rawSecret))).verify.statusCode).toBe(
      200,
    );
    expect((await confirm(ann.jar, await totpNow(annRaw))).statusCode).toBe(200);
  });

  it('refuses the same user from a different session', async () => {
    const user = await userWith2fa(app);
    const elsewhere = await signInWithTotp(user.email, await totpNow(user.rawSecret));
    const newRaw = await startWithTotp(user);
    const res = await confirm(elsewhere.jar, await totpNow(newRaw));
    expect(errorCode(res)).toBe('MOVE_NOT_STARTED');
    expect((await confirm(user.jar, await totpNow(newRaw))).statusCode).toBe(200);
  });
});

describe('limits', () => {
  it('counts wrong codes toward the 2FA lockout, which then also stops sign-in', async () => {
    const user = await userWith2fa(app);
    const newRaw = await startWithTotp(user);
    const wrong = await wrongCodeFor(newRaw);
    for (let i = 0; i < 5; i++)
      expect(errorCode(await confirm(user.jar, wrong))).toBe('INVALID_CODE');
    const locked = await confirm(user.jar, await totpNow(newRaw));
    expect(locked.statusCode).toBe(429);
    expect(errorCode(locked)).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    const startLocked = await start(user.jar, {
      password: TEST_PASSWORD,
      code: await totpNow(user.rawSecret),
    });
    expect(errorCode(startLocked)).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    const signInLocked = await signInWithTotp(user.email, await totpNow(user.rawSecret));
    expect(signInLocked.verify.json().code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    // Locked, but 2FA is still on and the old secret still in place.
    expect(await twoFactorState(user.userId)).toMatchObject({ enabled: true, verified: true });
  });

  it('counts wrong current codes on start too', async () => {
    const user = await userWith2fa(app);
    await start(user.jar, { password: TEST_PASSWORD, code: await wrongCodeFor(user.rawSecret) });
    const [tf] = await db.select().from(twoFactors).where(eq(twoFactors.userId, user.userId));
    expect(tf!.failedVerificationCount).toBe(1);
    await startWithTotp(user);
    const [cleared] = await db.select().from(twoFactors).where(eq(twoFactors.userId, user.userId));
    expect(cleared!.failedVerificationCount).toBe(0);
  });

  it('rate-limits start to 5 per user per 15 minutes', async () => {
    const user = await userWith2fa(app);
    for (let i = 0; i < 5; i++) {
      expect(errorCode(await start(user.jar, { password: 'Wrong password1' }))).toBe(
        'INVALID_PASSWORD',
      );
    }
    const limited = await start(user.jar, { password: 'Wrong password1' });
    expect(limited.statusCode).toBe(429);
    expect(errorCode(limited)).toBe('RATE_LIMITED');
    // Someone else on the same address is not held up by it.
    const other = await userWith2fa(app);
    expect(errorCode(await start(other.jar, { password: 'Wrong password1' }))).toBe(
      'INVALID_PASSWORD',
    );
  });

  it('rate-limits confirm to 10 per user per 15 minutes', async () => {
    const user = await userWith2fa(app);
    for (let i = 0; i < 10; i++) {
      expect(errorCode(await confirm(user.jar, '123456'))).toBe('MOVE_NOT_STARTED');
    }
    const limited = await confirm(user.jar, '123456');
    expect(limited.statusCode).toBe(429);
    expect(errorCode(limited)).toBe('RATE_LIMITED');
  });
});

describe('the API log', () => {
  it('records each step without secrets, codes or passwords', async () => {
    const user = await userWith2fa(app);
    const startRes = await start(user.jar, { password: TEST_PASSWORD, code: user.backupCodes[0] });
    const { totpURI } = startRes.json() as { totpURI: string };
    const newRaw = rawFromUri(totpURI);
    const wrong = await wrongCodeFor(newRaw);
    await confirm(user.jar, wrong);
    const newCode = await totpNow(newRaw);
    const { backupCodes } = (await confirm(user.jar, newCode)).json() as { backupCodes: string[] };

    const log = logLines.join('');
    for (const event of ['two_factor_move_started', 'two_factor_move_failed', 'two_factor_moved']) {
      expect(log).toContain(event);
    }
    const secrets = [
      TEST_PASSWORD,
      user.rawSecret,
      newRaw,
      new URL(totpURI).searchParams.get('secret')!,
      user.backupCodes[0]!,
      wrong,
      newCode,
      ...backupCodes,
    ];
    for (const s of secrets) expect(log).not.toContain(s);
  });
});
