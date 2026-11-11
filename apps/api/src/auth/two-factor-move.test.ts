import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { recoveryCodeSchema } from '@family-tree/shared';
import { symmetricDecrypt } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';
import {
  encryptRecoveryCodes,
  encryptTotpSecret,
  newRecoveryCodes,
  newTotpSecret,
  totpUri,
} from './two-factor-move.js';

const KEY = 'unit-test-secret-unit-test-secret-0000';

describe('a new authenticator secret', () => {
  it('is 32 random characters, like Better Auth enable makes', () => {
    const a = newTotpSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newTotpSecret()).not.toBe(a);
  });

  it('is stored encrypted with the auth secret, readable by Better Auth', async () => {
    const raw = newTotpSecret();
    const stored = await encryptTotpSecret(KEY, raw);
    expect(stored).not.toContain(raw);
    expect(await symmetricDecrypt({ key: KEY, data: stored })).toBe(raw);
  });

  it('goes into an otpauth URI with the app as issuer, whose codes match the secret', async () => {
    const raw = newTotpSecret();
    const uri = new URL(totpUri(raw, 'ann@example.com'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('issuer')).toBe('Family Tree');
    expect(decodeURIComponent(uri.pathname)).toContain('ann@example.com');
    const fromUri = new TextDecoder().decode(base32.decode(uri.searchParams.get('secret')!));
    expect(fromUri).toBe(raw);
    expect(await createOTP(fromUri).totp()).toBe(await createOTP(raw).totp());
  });
});

describe('new recovery codes', () => {
  it('are 8 distinct codes shaped like Better Auth makes them', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);
      expect(recoveryCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('are stored as an encrypted JSON array, as Better Auth stores them', async () => {
    const codes = newRecoveryCodes();
    const stored = await encryptRecoveryCodes(KEY, codes);
    expect(stored).not.toContain(codes[0]);
    expect(JSON.parse(await symmetricDecrypt({ key: KEY, data: stored }))).toEqual(codes);
  });
});
