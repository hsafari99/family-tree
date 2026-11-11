// Spec §5: move two-step verification to a new phone without ever turning it off.
//
// Better Auth 1.7.18's twoFactor plugin has no way to replace a verified secret: /two-factor/enable
// refuses once TOTP is verified, and the only other path is /two-factor/disable then enable,
// which leaves the account without 2FA in between (owners couldn't create trees and stewards
// would lose their powers meanwhile). So the new secret waits in two_factor_moves and replaces
// two_factors.secret in one transaction once a code from the new phone checks out.
//
// Mirrors better-auth@1.7.18 plugins/two-factor/index.mjs (enable: generateRandomString(32),
// symmetricEncrypt with ctx.secretConfig, createOTP(...).url(issuer, email)) and
// backup-codes/index.mjs (generateBackupCodesFn, encodeBackupCodes "encrypted"). Re-check those
// files whenever better-auth is upgraded; two-factor-move.int.test.ts signs in through Better
// Auth's own endpoints after a move, so it fails if they drift.
import { createOTP } from '@better-auth/utils/otp';
import { generateRandomString, symmetricEncrypt } from 'better-auth/crypto';
import { and, eq, like, lte, ne, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, twoFactorMoves, twoFactors, verifications } from '../db/schema.js';
import {
  checkLockout,
  decryptTotpSecret,
  recordFailure,
  type TwoFactorKey,
  verifyTotp,
} from './totp-reset.js';

/** The issuer shown in authenticator apps (twoFactor({ issuer }) in auth.ts). */
export const TWO_FACTOR_ISSUER = 'Family Tree';
/** Recovery codes per enrolment (twoFactor({ backupCodeOptions: { amount } }) in auth.ts). */
export const RECOVERY_CODE_COUNT = 8;
/** How long a started move waits for a code from the new phone. */
export const MOVE_TTL_MS = 10 * 60 * 1000;

// better-auth's defaults: we pass no totpOptions.
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const RECOVERY_CODE_LENGTH = 10;

/** A raw authenticator secret, as /two-factor/enable makes one. */
export function newTotpSecret(): string {
  return generateRandomString(32);
}

/** How two_factors.secret (and two_factor_moves.secret) hold it. */
export function encryptTotpSecret(key: TwoFactorKey, raw: string): Promise<string> {
  return symmetricEncrypt({ key, data: raw });
}

/** The otpauth:// URI the setup screen turns into a QR code and shows the key from. */
export function totpUri(raw: string, email: string): string {
  return createOTP(raw, { digits: TOTP_DIGITS, period: TOTP_PERIOD }).url(TWO_FACTOR_ISSUER, email);
}

/** Recovery codes shaped like Better Auth's: 10 letters and digits, split 5-5. */
export function newRecoveryCodes(amount = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: amount }, () => {
    const code = generateRandomString(RECOVERY_CODE_LENGTH, 'a-z', '0-9', 'A-Z');
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** How two_factors.backup_codes holds them: the JSON array, encrypted. */
export function encryptRecoveryCodes(key: TwoFactorKey, codes: string[]): Promise<string> {
  return symmetricEncrypt({ key, data: JSON.stringify(codes) });
}

/**
 * Deletes every pending move past its expiry (anyone's). Run on each start and by the purge job,
 * so abandoned secrets don't linger. Returns how many went.
 */
export async function purgeExpiredMoves(db: Db): Promise<number> {
  const gone = await db
    .delete(twoFactorMoves)
    .where(lte(twoFactorMoves.expiresAt, new Date()))
    .returning({ id: twoFactorMoves.id });
  return gone.length;
}

/**
 * Keeps a new secret pending for the user (replacing any older pending one) and returns the
 * otpauth URI for it. The caller has already re-authenticated the user. Expired pending moves of
 * anyone are dropped first.
 */
export async function startMove(
  db: Db,
  key: TwoFactorKey,
  { userId, sessionId, email }: { userId: string; sessionId: string; email: string },
): Promise<{ totpURI: string }> {
  await purgeExpiredMoves(db);
  const raw = newTotpSecret();
  const secret = await encryptTotpSecret(key, raw);
  const expiresAt = new Date(Date.now() + MOVE_TTL_MS);
  await db
    .insert(twoFactorMoves)
    .values({ userId, sessionId, secret, expiresAt })
    .onConflictDoUpdate({
      target: twoFactorMoves.userId,
      set: { sessionId, secret, expiresAt, createdAt: new Date() },
    });
  return { totpURI: totpUri(raw, email) };
}

/** Drops the user's pending move, if any. */
export async function cancelMove(db: Db, userId: string): Promise<boolean> {
  const gone = await db
    .delete(twoFactorMoves)
    .where(eq(twoFactorMoves.userId, userId))
    .returning({ id: twoFactorMoves.id });
  return gone.length > 0;
}

export type ConfirmOutcome =
  | { status: 'moved'; backupCodes: string[]; otherSessionsRevoked: number }
  | { status: 'not_started' | 'expired' | 'invalid' | 'locked' };

/**
 * Checks `code` against the pending secret and, if it matches, swaps it in. One transaction
 * holding both rows: the real secret is replaced, new recovery codes replace the old ones, the
 * pending row goes, and every other session of the user (plus any trusted-device record or
 * half-finished 2FA sign-in) is revoked. two_factors.verified and users.two_factor_enabled are
 * never touched, so 2FA is on at every instant.
 *
 * Anything else leaves the old phone working: no pending move (or one from another session),
 * an expired one (deleted), a wrong code (counted toward the 2FA lockout), or a locked account.
 */
export async function confirmMove(
  db: Db,
  key: TwoFactorKey,
  { userId, sessionId, code }: { userId: string; sessionId: string; code: string },
): Promise<ConfirmOutcome> {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(twoFactorMoves)
      .where(eq(twoFactorMoves.userId, userId))
      .for('update');
    if (!pending || pending.sessionId !== sessionId) return { status: 'not_started' };
    if (pending.expiresAt.getTime() <= Date.now()) {
      await tx.delete(twoFactorMoves).where(eq(twoFactorMoves.id, pending.id));
      return { status: 'expired' };
    }

    const [current] = await tx
      .select()
      .from(twoFactors)
      .where(and(eq(twoFactors.userId, userId), eq(twoFactors.verified, true)))
      .for('update');
    if (!current) {
      // 2FA was turned off since the move started: the pending secret is useless now.
      await tx.delete(twoFactorMoves).where(eq(twoFactorMoves.id, pending.id));
      return { status: 'not_started' };
    }
    if ((await checkLockout(tx, current)) === 'locked') return { status: 'locked' };

    if (!(await verifyTotp(await decryptTotpSecret(key, pending.secret), code))) {
      await recordFailure(tx, current.id);
      return { status: 'invalid' };
    }

    const backupCodes = newRecoveryCodes();
    await tx
      .update(twoFactors)
      .set({
        // Already encrypted with the same key, so the ciphertext moves over as it is.
        secret: pending.secret,
        backupCodes: await encryptRecoveryCodes(key, backupCodes),
        failedVerificationCount: 0,
        lockedUntil: null,
      })
      .where(eq(twoFactors.id, current.id));
    await tx.delete(twoFactorMoves).where(eq(twoFactorMoves.id, pending.id));
    const revoked = await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, sessionId)))
      .returning({ id: sessions.id });
    // Better Auth keeps trusted devices and pending 2FA sign-ins as verification rows whose value
    // is the user id (two-factor/index.mjs, verify-two-factor.mjs).
    await tx
      .delete(verifications)
      .where(
        and(
          eq(verifications.value, userId),
          or(
            like(verifications.identifier, 'trust-device-%'),
            like(verifications.identifier, '2fa-%'),
          ),
        ),
      );
    return { status: 'moved', backupCodes, otherSessionsRevoked: revoked.length };
  });
}
