// Mirrors better-auth@1.7.18 two-factor storage and lockout (plugins/two-factor/{totp,backup-codes}
// and verify-two-factor.mjs). Re-check those files whenever better-auth is upgraded;
// password-reset.int.test.ts will fail if they drift.
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { symmetricDecrypt, symmetricEncrypt, type SecretConfig } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { twoFactors } from '../db/schema.js';
import { TWO_FACTOR_LOCK_SECONDS, TWO_FACTOR_MAX_FAILED_ATTEMPTS } from './auth.js';

/** What Better Auth passes to symmetricEncrypt/Decrypt for 2FA data: `ctx.secretConfig`. */
export type TwoFactorKey = string | SecretConfig;

// better-auth's totp2fa defaults (we pass no totpOptions); verify() uses window 1.
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const TOTP_WINDOW = 1;
const BASE32_PREFIX = 'base32:';

/** totp/index.mjs decryptTOTPSecret: secrets may be stored as "base32:<encoded>". */
async function decryptTotpSecret(key: TwoFactorKey, data: string): Promise<string | Uint8Array> {
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

function writeBackupCodes(key: TwoFactorKey, codes: string[]): Promise<string> {
  return symmetricEncrypt({ key, data: JSON.stringify(codes) });
}

/**
 * Verifies an authenticator code or spends a recovery code for a user with verified 2FA.
 *
 * Shares Better Auth's account lockout: while `lockedUntil` is in the future every attempt
 * fails; each failure adds to `failedVerificationCount` and locks the account for 15 minutes
 * once it reaches the limit; a success clears both. An expired lock starts the count afresh.
 * Everything runs in one transaction holding the two_factors row (SELECT ... FOR UPDATE), so
 * concurrent requests can't both spend one recovery code or lose a failure count.
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
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(twoFactors)
      .where(and(eq(twoFactors.userId, userId), eq(twoFactors.verified, true)))
      .for('update');
    if (!row) return false;

    const now = Date.now();
    if (row.lockedUntil && row.lockedUntil.getTime() > now) return false;
    // Better Auth lazily clears an expired lock together with its counter.
    const priorFailures = row.lockedUntil ? 0 : row.failedVerificationCount;

    let updatedBackupCodes: string | undefined;
    let valid = false;
    if (/^\d{6}$/.test(code)) {
      const secret = await decryptTotpSecret(key, row.secret);
      valid = await createOTP(secret, { digits: TOTP_DIGITS, period: TOTP_PERIOD }).verify(code, {
        window: TOTP_WINDOW,
      });
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
      const failures = priorFailures + 1;
      await tx
        .update(twoFactors)
        .set({
          failedVerificationCount: failures,
          lockedUntil:
            failures >= TWO_FACTOR_MAX_FAILED_ATTEMPTS
              ? new Date(now + TWO_FACTOR_LOCK_SECONDS * 1000)
              : null,
        })
        .where(eq(twoFactors.id, row.id));
      return false;
    }

    await tx
      .update(twoFactors)
      .set({
        failedVerificationCount: 0,
        lockedUntil: null,
        ...(updatedBackupCodes === undefined ? {} : { backupCodes: updatedBackupCodes }),
      })
      .where(eq(twoFactors.id, row.id));
    return true;
  });
}
