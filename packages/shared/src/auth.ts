import { z } from 'zod';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'));
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`);
export const nameSchema = z.string().trim().min(1, 'Enter your name').max(100);
// Authenticator apps often show the code as "123 456"; accept it with any whitespace.
export const totpCodeSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));
export const recoveryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/, 'Enter a recovery code like abcde-12345');
export const resetCodeSchema = z.union([totpCodeSchema, recoveryCodeSchema], {
  error: 'Enter a 6-digit code or a recovery code',
});

export const signUpSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export const signInSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, 'Enter your password')
    .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`),
});
export const resetWithCodeSchema = z.object({
  email: emailSchema,
  code: resetCodeSchema,
  newPassword: passwordSchema,
});
export const resetWithLinkSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordSchema,
});
export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    twoFactorEnabled: z.boolean(),
    /** True when the user owns a tree or holds a steward grant. */
    requiresTwoFactor: z.boolean(),
    /** Whether the account has a password login (Google-only accounts don't). */
    hasPassword: z.boolean(),
    googleConnected: z.boolean(),
  }),
});
// Spec §5: moving 2FA to a new phone. Start re-checks the password (none for a Google-only
// account, which needs a recent sign-in instead) and a current authenticator or recovery code;
// the server says which one is missing or wrong. Confirm takes a code from the new phone.
export const twoFactorMoveStartSchema = z.object({
  password: z.string().max(PASSWORD_MAX).optional(),
  code: z.string().max(64).optional(),
});
export const twoFactorMoveConfirmSchema = z.object({ code: totpCodeSchema });
export const twoFactorMoveStartedSchema = z.object({
  totpURI: z.string().startsWith('otpauth://totp/'),
});
export const twoFactorMovedSchema = z.object({ backupCodes: z.array(z.string()).min(1) });
export const setPasswordSchema = z.object({ newPassword: passwordSchema });
export const authProvidersSchema = z.object({ google: z.boolean() });
export type AuthProviders = z.infer<typeof authProvidersSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
