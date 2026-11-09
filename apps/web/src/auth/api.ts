import { apiErrorSchema, type MeResponse, meResponseSchema } from '@family-tree/shared';
import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export type SessionUser = MeResponse['user'];

export interface AuthError {
  code: string;
  message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AuthError };

/** Everything the pages need from the server. Tests use an in-memory fake (test/fake-auth.ts). */
export interface AuthApi {
  /** The signed-in user, or `null` when signed out. */
  getMe(): Promise<Result<SessionUser | null>>;
  signUp(input: { name: string; email: string; password: string }): Promise<Result<void>>;
  signIn(input: {
    email: string;
    password: string;
  }): Promise<Result<{ twoFactorRequired: boolean }>>;
  verifyTotp(input: { code: string; trustDevice: false }): Promise<Result<void>>;
  verifyRecoveryCode(input: { code: string }): Promise<Result<void>>;
  signOut(): Promise<Result<void>>;
  startTwoFactorSetup(input: {
    password: string;
  }): Promise<Result<{ totpURI: string; backupCodes: string[] }>>;
  confirmTwoFactorSetup(input: { code: string }): Promise<Result<void>>;
  regenerateRecoveryCodes(input: { password: string }): Promise<Result<string[]>>;
  disableTwoFactor(input: { password: string }): Promise<Result<void>>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<Result<void>>;
  resetWithCode(input: { email: string; code: string; newPassword: string }): Promise<Result<void>>;
  resetWithLink(input: { token: string; newPassword: string }): Promise<Result<void>>;
}

export const MESSAGES = {
  badCredentials: 'Email or password is incorrect',
  tooMany: 'Too many attempts, wait a minute and try again',
  locked: 'Too many wrong codes. Two-step verification is locked for 15 minutes, try again later',
  newChallenge: 'Too many wrong codes. Sign in again to get a fresh attempt',
  challengeExpired: 'Your sign-in has expired. Sign in again',
  badCode: 'That code is incorrect',
  badRecoveryCode: 'That recovery code is incorrect or has already been used',
  badPassword: 'Password is incorrect',
  emailTaken: 'An account with this email already exists',
  network: 'Cannot reach the server, check your connection and try again',
  unknown: 'Something went wrong, try again',
} as const;

/** Friendly messages for Better Auth error codes (see its BASE_ERROR_CODES / TWO_FACTOR_ERROR_CODES). */
const BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: MESSAGES.badCredentials,
  INVALID_PASSWORD: MESSAGES.badPassword,
  INVALID_CODE: MESSAGES.badCode,
  INVALID_BACKUP_CODE: MESSAGES.badRecoveryCode,
  INVALID_TWO_FACTOR_COOKIE: MESSAGES.challengeExpired,
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: MESSAGES.newChallenge,
  ACCOUNT_TEMPORARILY_LOCKED: MESSAGES.locked,
  USER_ALREADY_EXISTS: MESSAGES.emailTaken,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: MESSAGES.emailTaken,
};

/** Turns a status and an error body (Better Auth's or ours) into a message for people. */
export function toAuthError(status: number, code?: string, message?: string): AuthError {
  const resolvedCode = code || (status === 429 ? 'RATE_LIMITED' : `HTTP_${status}`);
  if (code && BY_CODE[code]) return { code, message: BY_CODE[code] };
  if (code === 'INVALID_RESET' && message) return { code, message };
  if (status === 401) return { code: resolvedCode, message: MESSAGES.badCredentials };
  if (status === 429) return { code: resolvedCode, message: MESSAGES.tooMany };
  if (status >= 400 && status < 500 && message) return { code: resolvedCode, message };
  return { code: resolvedCode, message: MESSAGES.unknown };
}

const networkError = (): Result<never> => ({
  ok: false,
  error: { code: 'NETWORK', message: MESSAGES.network },
});

type BetterAuthResult<T> = {
  data: T | null;
  error: { status: number; code?: string; message?: string } | null;
};

async function run<T, R>(
  call: () => Promise<BetterAuthResult<T>>,
  map: (data: T) => R,
): Promise<Result<R>> {
  let res: BetterAuthResult<T>;
  try {
    res = await call();
  } catch {
    return networkError();
  }
  if (res.error) {
    return { ok: false, error: toAuthError(res.error.status, res.error.code, res.error.message) };
  }
  return { ok: true, data: map(res.data as T) };
}

const nothing = () => undefined;

export function createAuthApi({ baseUrl }: { baseUrl: string }): AuthApi {
  const origin = baseUrl.replace(/\/+$/, '');
  // No twoFactorPage: the sign-in page reads twoFactorRedirect and navigates itself.
  const client = createAuthClient({ baseURL: origin, plugins: [twoFactorClient()] });

  async function v1(path: string, init?: { method: 'POST'; body: unknown }) {
    try {
      return await fetch(`${origin}/api/v1${path}`, {
        credentials: 'include',
        ...(init
          ? {
              method: init.method,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(init.body),
            }
          : {}),
      });
    } catch {
      return null;
    }
  }

  async function v1Error(res: Response): Promise<Result<never>> {
    const body: unknown = await res.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(body);
    const err = parsed.success ? parsed.data.error : undefined;
    return { ok: false, error: toAuthError(res.status, err?.code, err?.message) };
  }

  async function v1Post(path: string, body: unknown): Promise<Result<void>> {
    const res = await v1(path, { method: 'POST', body });
    if (!res) return networkError();
    if (!res.ok) return v1Error(res);
    return { ok: true, data: undefined };
  }

  return {
    async getMe() {
      const res = await v1('/me');
      if (!res) return networkError();
      if (res.status === 401) return { ok: true, data: null };
      if (!res.ok) return v1Error(res);
      const parsed = meResponseSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) return { ok: false, error: toAuthError(500) };
      return { ok: true, data: parsed.data.user };
    },
    signUp: ({ name, email, password }) =>
      run(() => client.signUp.email({ name, email, password }), nothing),
    signIn: ({ email, password }) =>
      run(
        () => client.signIn.email({ email, password }),
        (data) => ({
          twoFactorRequired:
            typeof data === 'object' &&
            data !== null &&
            'twoFactorRedirect' in data &&
            data.twoFactorRedirect === true,
        }),
      ),
    verifyTotp: ({ code, trustDevice }) =>
      run(() => client.twoFactor.verifyTotp({ code, trustDevice }), nothing),
    verifyRecoveryCode: ({ code }) =>
      run(() => client.twoFactor.verifyBackupCode({ code }), nothing),
    signOut: () => run(() => client.signOut(), nothing),
    startTwoFactorSetup: ({ password }) =>
      run(
        () => client.twoFactor.enable({ password, method: 'totp' }),
        (data) =>
          'totpURI' in data
            ? { totpURI: data.totpURI, backupCodes: data.backupCodes }
            : { totpURI: '', backupCodes: [] },
      ),
    confirmTwoFactorSetup: ({ code }) => run(() => client.twoFactor.verifyTotp({ code }), nothing),
    regenerateRecoveryCodes: ({ password }) =>
      run(
        () => client.twoFactor.generateBackupCodes({ password }),
        (data) => data.backupCodes,
      ),
    disableTwoFactor: ({ password }) => run(() => client.twoFactor.disable({ password }), nothing),
    changePassword: ({ currentPassword, newPassword }) =>
      run(
        () => client.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }),
        nothing,
      ),
    resetWithCode: (input) => v1Post('/password-reset/totp', input),
    resetWithLink: (input) => v1Post('/password-reset/link', input),
  };
}
