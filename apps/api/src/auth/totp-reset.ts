// Mirrors better-auth@1.7.18 two-factor storage (plugins/two-factor/{totp,backup-codes}) and its
// lockout (verify-two-factor.mjs). Re-check those files whenever better-auth is upgraded;
// password-reset.int.test.ts and two-factor-move.int.test.ts will fail if they drift.
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { symmetricDecrypt, symmetricEncrypt, type SecretConfig } from 'better-auth/crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { twoFactors } from '../db/schema.js';

/** What Better Auth passes to symmetricEncrypt/Decrypt for 2FA data: `ctx.secretConfig`. */
export type TwoFactorKey = string | SecretConfig;

// better-auth's totp2fa defaults (we pass no totpOptions); verify() uses window 1.
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const TOTP_WINDOW = 1;
const BASE32_PREFIX = 'base32:';

/** Spec §5: lock 2FA after this many consecutive failures (twoFactor accountLockout in auth.ts). */
export const TWO_FACTOR_MAX_FAILED_ATTEMPTS = 5;
/** Better Auth's default lock duration (accountLockout.durationSeconds), stated explicitly. */
export const TWO_FACTOR_LOCK_SECONDS = 15 * 60;

/** totp/index.mjs decryptTOTPSecret: secrets may be stored as "base32:<encoded>". */
export async function decryptTotpSecret(
  key: TwoFactorKey,
  data: string,
): Promise<string | Uint8Array> {
  const secret = await symmetricDecrypt({ key, data });
  if (!secret.startsWith(BASE32_PREFIX)) return secret;
  return base32.decode(secret.slice(BASE32_PREFIX.length).toUpperCase());
}

/** backup-codes/index.mjs with storeBackupCodes "encrypted" (the default): encrypted JSON array. */
async function readBackupCodes(key: TwoFactorKey, data: string): Promise<string[] | null> {
  try {
    const parsed: unknown = JSON.parse(await symmetricDecrypt({ key, data }));
    return Array.isArray(parsed) && parsed.every((c) => typeof c === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

/** Whether `code` is the current authenticator code (±1 step, as Better Auth checks it). */
export function verifyTotp(secret: string | Uint8Array, code: string): Promise<boolean> {
  return createOTP(secret, { digits: TOTP_DIGITS, period: TOTP_PERIOD }).verify(code, {
    window: TOTP_WINDOW,
  });
}

type TwoFactorRow = typeof twoFactors.$inferSelect;

/**
 * verify-two-factor.mjs assertTwoFactorNotLocked: 'locked' while lockedUntil is in the future;
 * a lock that has run out is cleared (counter back to 0) first. Call inside a transaction holding
 * the row.
 */
export async function checkLockout(tx: Tx, row: TwoFactorRow): Promise<'locked' | 'open'> {
  if (!row.lockedUntil) return 'open';
  if (row.lockedUntil.getTime() > Date.now()) return 'locked';
  await tx
    .update(twoFactors)
    .set({ failedVerificationCount: 0, lockedUntil: null })
    .where(eq(twoFactors.id, row.id));
  return 'open';
}

/**
 * verify-two-factor.mjs recordTwoFactorFailure: one more consecutive failure, and the lock once
 * the budget is spent. Sign-in through Better Auth honours the same lock.
 */
export async function recordFailure(tx: Tx, twoFactorId: string): Promise<void> {
  const [row] = await tx
    .update(twoFactors)
    .set({ failedVerificationCount: sql`${twoFactors.failedVerificationCount} + 1` })
    .where(eq(twoFactors.id, twoFactorId))
    .returning({ failed: twoFactors.failedVerificationCount });
  if ((row?.failed ?? 0) >= TWO_FACTOR_MAX_FAILED_ATTEMPTS) {
    await tx
      .update(twoFactors)
      .set({ lockedUntil: new Date(Date.now() + TWO_FACTOR_LOCK_SECONDS * 1000) })
      .where(eq(twoFactors.id, twoFactorId));
  }
}

function writeBackupCodes(key: TwoFactorKey, codes: string[]): Promise<string> {
  return symmetricEncrypt({ key, data: JSON.stringify(codes) });
}

export type SecondFactorCheck = 'valid' | 'invalid' | 'locked' | 'not_enabled';

/**
 * Verifies an authenticator code or spends a recovery code for a user with verified 2FA.
 * While the 2FA lockout holds, every attempt is 'locked'; a success clears the counter and the
 * lock, since the caller proved possession of the second factor. With `countFailures`, a wrong
 * code counts toward the lockout as a failed sign-in does: only for a signed-in user re-checking
 * their own factor (moving 2FA to a new phone), never for a route anyone can call.
 * Everything runs in one transaction holding the two_factors row (SELECT ... FOR UPDATE), so
 * concurrent requests can't both spend one recovery code.
 */
export async function checkSecondFactor(
  db: Db,
  key: TwoFactorKey,
  userId: string,
  code: string,
  { countFailures }: { countFailures: boolean },
): Promise<{ result: SecondFactorCheck; via?: 'totp' | 'recovery_code' }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(twoFactors)
      .where(and(eq(twoFactors.userId, userId), eq(twoFactors.verified, true)))
      .for('update');
    if (!row) return { result: 'not_enabled' };

    if (countFailures) {
      if ((await checkLockout(tx, row)) === 'locked') return { result: 'locked' };
    } else if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
      return { result: 'locked' };
    }

    let updatedBackupCodes: string | undefined;
    let valid = false;
    const via = /^\d{6}$/.test(code) ? 'totp' : 'recovery_code';
    if (via === 'totp') {
      valid = await verifyTotp(await decryptTotpSecret(key, row.secret), code);
    } else {
      const codes = await readBackupCodes(key, row.backupCodes);
      if (codes?.includes(code)) {
        valid = true;
        updatedBackupCodes = await writeBackupCodes(
          key,
          codes.filter((c) => c !== code),
        );
      }
    }

    if (!valid) {
      if (countFailures) await recordFailure(tx, row.id);
      return { result: 'invalid' };
    }

    await tx
      .update(twoFactors)
      .set({
        failedVerificationCount: 0,
        lockedUntil: null,
        ...(updatedBackupCodes === undefined ? {} : { backupCodes: updatedBackupCodes }),
      })
      .where(eq(twoFactors.id, row.id));
    return { result: 'valid', via };
  });
}

/**
 * checkSecondFactor without counting failures, for the email-only reset route and for Connect or
 * Disconnect Google. A failure there does NOT count toward the lock: the reset route needs only
 * an email, so counting would let anyone lock a user out of sign-in. Guessing stays bounded by
 * the routes' rate limits (5 per email and 20 per IP per 15 minutes).
 *
 * Like Better Auth, an authenticator code stays valid for its whole window (±1 step), so it can
 * be replayed within ~90 seconds. Accepted: the attacker would also need the email, and the
 * per-email and per-IP limits plus the lockout still apply.
 */
export async function verifyAndConsumeSecondFactor(
  db: Db,
  key: TwoFactorKey,
  userId: string,
  code: string,
): Promise<boolean> {
  return (
    (await checkSecondFactor(db, key, userId, code, { countFailures: false })).result === 'valid'
  );
}
