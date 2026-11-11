import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  PASSWORD_CLASSES_MESSAGE,
  PASSWORD_HINT,
  PASSWORD_MIN,
  passwordSchema,
  resetCodeSchema,
  resetWithCodeSchema,
  resetWithLinkSchema,
  signInSchema,
  signUpSchema,
  totpCodeSchema,
  twoFactorMoveConfirmSchema,
  twoFactorMovedSchema,
  twoFactorMoveStartedSchema,
  twoFactorMoveStartSchema,
} from './auth.js';

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('passwordSchema', () => {
  // A capital, a digit and a symbol, padded with lowercase to the length under test.
  const pw = (length: number) => 'A1!' + 'a'.repeat(length - 3);
  it('accepts 10 to 128 characters', () => {
    expect(ok(passwordSchema, pw(9))).toBe(false);
    expect(ok(passwordSchema, pw(10))).toBe(true);
    expect(ok(passwordSchema, pw(128))).toBe(true);
    expect(ok(passwordSchema, pw(129))).toBe(false);
  });
  const messages = (v: string) => passwordSchema.safeParse(v).error?.issues.map((i) => i.message);
  it.each([
    ['a capital letter', 'lowercase1!x'],
    ['a digit', 'Lowercase!xy'],
    ['a symbol', 'Lowercase1xy'],
    ['all three', 'lowercasexyz'],
  ])('refuses a password without %s, with the fixed message', (_what, value) => {
    expect(messages(value)).toEqual([PASSWORD_CLASSES_MESSAGE]);
  });
  it('counts a space or any non-letter, non-digit as a symbol', () => {
    expect(ok(passwordSchema, 'Correct horse 1')).toBe(true);
    expect(ok(passwordSchema, 'Correct_horse1')).toBe(true);
    expect(ok(passwordSchema, 'Ünïcode-pässwörd9')).toBe(true);
  });
  it('the hint names every requirement', () => {
    expect(PASSWORD_HINT).toBe(
      `At least ${PASSWORD_MIN} characters, with a capital letter, a number and a symbol.`,
    );
    expect(PASSWORD_CLASSES_MESSAGE).toBe(
      'Use at least one capital letter, one number and one symbol',
    );
  });
});

describe('signInSchema', () => {
  it('never checks the new-password rule, so old passwords keep working', () => {
    expect(ok(signInSchema, { email: 'a@b.co', password: 'old weak pw' })).toBe(true);
    expect(ok(signInSchema, { email: 'a@b.co', password: 'x' })).toBe(true);
  });
});

describe('emailSchema', () => {
  it('trims and lowercases', () => {
    expect(emailSchema.parse('  Ann@Example.COM ')).toBe('ann@example.com');
  });
  it('rejects a non-email', () => {
    expect(ok(emailSchema, 'not-an-email')).toBe(false);
  });
});

describe('signUpSchema', () => {
  const base = { email: 'a@b.co', password: 'Long enough pw1' };
  it('requires a name of 1-100 characters after trimming', () => {
    expect(ok(signUpSchema, { ...base, name: '   ' })).toBe(false);
    expect(ok(signUpSchema, { ...base, name: 'a'.repeat(101) })).toBe(false);
    expect(signUpSchema.parse({ ...base, name: '  Ann  ' }).name).toBe('Ann');
    expect(ok(signUpSchema, { ...base, name: 'a'.repeat(100) })).toBe(true);
  });
});

describe('totpCodeSchema', () => {
  it('accepts six digits only', () => {
    expect(ok(totpCodeSchema, '123456')).toBe(true);
    expect(ok(totpCodeSchema, '12345')).toBe(false);
  });
  it('ignores whitespace inside the code', () => {
    expect(totpCodeSchema.parse('123 456')).toBe('123456');
    expect(totpCodeSchema.parse(' 123456 ')).toBe('123456');
    expect(ok(totpCodeSchema, '123 45')).toBe(false);
  });
});

describe('resetCodeSchema', () => {
  it('accepts a 6-digit code or a recovery code', () => {
    expect(ok(resetCodeSchema, '123456')).toBe(true);
    expect(ok(resetCodeSchema, 'sCJis-ruroZ')).toBe(true);
    expect(ok(resetCodeSchema, 'sCJisruroZ')).toBe(false);
    expect(ok(resetCodeSchema, '1234567')).toBe(false);
  });
});

describe('resetWithCodeSchema', () => {
  it('needs email, code and a valid new password', () => {
    expect(
      ok(resetWithCodeSchema, { email: 'a@b.co', code: '123456', newPassword: 'Long enough pw1' }),
    ).toBe(true);
    expect(ok(resetWithCodeSchema, { email: 'a@b.co', code: '123456', newPassword: 'short' })).toBe(
      false,
    );
    expect(ok(resetWithCodeSchema, { email: 'a@b.co', newPassword: 'Long enough pw1' })).toBe(
      false,
    );
  });
});

describe('resetWithLinkSchema', () => {
  it('needs a 20-200 character token and a valid new password', () => {
    const newPassword = 'Long enough pw1';
    expect(ok(resetWithLinkSchema, { token: 'a'.repeat(19), newPassword })).toBe(false);
    expect(ok(resetWithLinkSchema, { token: 'a'.repeat(20), newPassword })).toBe(true);
    expect(ok(resetWithLinkSchema, { token: 'a'.repeat(200), newPassword })).toBe(true);
    expect(ok(resetWithLinkSchema, { token: 'a'.repeat(201), newPassword })).toBe(false);
    expect(ok(resetWithLinkSchema, { token: 'a'.repeat(20), newPassword: 'short' })).toBe(false);
  });
});

describe('signInSchema', () => {
  it('caps the password at the maximum length', () => {
    expect(ok(signInSchema, { email: 'a@b.co', password: 'x' })).toBe(true);
    expect(ok(signInSchema, { email: 'a@b.co', password: 'a'.repeat(128) })).toBe(true);
    expect(ok(signInSchema, { email: 'a@b.co', password: 'a'.repeat(129) })).toBe(false);
    expect(ok(signInSchema, { email: 'a@b.co', password: '' })).toBe(false);
  });
});

describe('moving 2FA to a new phone', () => {
  it('starts with an optional password and an optional code, both capped', () => {
    expect(twoFactorMoveStartSchema.parse({ password: 'pw', code: '123456' })).toEqual({
      password: 'pw',
      code: '123456',
    });
    expect(ok(twoFactorMoveStartSchema, {})).toBe(true);
    expect(ok(twoFactorMoveStartSchema, { password: 'a'.repeat(129) })).toBe(false);
    expect(ok(twoFactorMoveStartSchema, { code: 'a'.repeat(65) })).toBe(false);
    expect(ok(twoFactorMoveStartSchema, { code: 123456 })).toBe(false);
  });

  it('confirms with a 6-digit code from the new phone only', () => {
    expect(twoFactorMoveConfirmSchema.parse({ code: '123 456' })).toEqual({ code: '123456' });
    expect(ok(twoFactorMoveConfirmSchema, { code: 'sCJis-ruroZ' })).toBe(false);
    expect(ok(twoFactorMoveConfirmSchema, {})).toBe(false);
  });

  it('answers with an otpauth URI, then with the new recovery codes', () => {
    expect(ok(twoFactorMoveStartedSchema, { totpURI: 'otpauth://totp/x?secret=AB' })).toBe(true);
    expect(ok(twoFactorMoveStartedSchema, { totpURI: 'https://example.com' })).toBe(false);
    expect(ok(twoFactorMovedSchema, { backupCodes: ['abcde-12345'] })).toBe(true);
    expect(ok(twoFactorMovedSchema, { backupCodes: [] })).toBe(false);
  });
});
