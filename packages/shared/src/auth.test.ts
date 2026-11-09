import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  passwordSchema,
  resetCodeSchema,
  resetWithCodeSchema,
  resetWithLinkSchema,
  signUpSchema,
  totpCodeSchema,
} from './auth.js';

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('passwordSchema', () => {
  it('accepts 10 to 128 characters', () => {
    expect(ok(passwordSchema, 'a'.repeat(9))).toBe(false);
    expect(ok(passwordSchema, 'a'.repeat(10))).toBe(true);
    expect(ok(passwordSchema, 'a'.repeat(128))).toBe(true);
    expect(ok(passwordSchema, 'a'.repeat(129))).toBe(false);
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
  const base = { email: 'a@b.co', password: 'long enough pw' };
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
      ok(resetWithCodeSchema, { email: 'a@b.co', code: '123456', newPassword: 'long enough pw' }),
    ).toBe(true);
    expect(ok(resetWithCodeSchema, { email: 'a@b.co', code: '123456', newPassword: 'short' })).toBe(
      false,
    );
    expect(ok(resetWithCodeSchema, { email: 'a@b.co', newPassword: 'long enough pw' })).toBe(false);
  });
});

describe('resetWithLinkSchema', () => {
  it('needs a 20-200 character token and a valid new password', () => {
    const newPassword = 'long enough pw';
    expect(ok(resetWithLinkSchema, { token: 'a'.repeat(19), newPassword })).toBe(false);
    expect(ok(resetWithLinkSchema, { token: 'a'.repeat(20), newPassword })).toBe(true);
    expect(ok(resetWithLinkSchema, { token: 'a'.repeat(200), newPassword })).toBe(true);
    expect(ok(resetWithLinkSchema, { token: 'a'.repeat(201), newPassword })).toBe(false);
    expect(ok(resetWithLinkSchema, { token: 'a'.repeat(20), newPassword: 'short' })).toBe(false);
  });
});
