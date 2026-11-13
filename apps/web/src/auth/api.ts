import {
  PASSWORD_CLASSES_MESSAGE,
  apiErrorSchema,
  type AuthProviders,
  avatarResponseSchema,
  authProvidersSchema,
  type MeResponse,
  meResponseSchema,
  twoFactorMovedSchema,
  twoFactorMoveStartedSchema,
} from '@family-tree/shared';
import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { leavePage } from './leave-page';
import { safeNext } from './safe-next';

export type SessionUser = MeResponse['user'];

export interface AuthError {
  code: string;
  message: string;
  /** VALIDATION only: the request fields the server named (its text is never shown). */
  fields?: string[];
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
  deleteAccount(input: { password: string }): Promise<Result<void>>;
  /** Which sign-in methods besides email and password are on. Failures read as "none". */
  getProviders(): Promise<Result<AuthProviders>>;
  /** Starts a Google sign-in that returns to `next` (a path on this site); leaves the page. */
  startGoogleSignIn(input: { next: string }): Promise<Result<void>>;
  /** Re-authenticates, then leaves for Google to connect it; comes back to /account/google. */
  connectGoogle(input: { password: string; code?: string }): Promise<Result<void>>;
  /** Re-authenticates like connectGoogle; refused while Google is the only way in. */
  disconnectGoogle(input: { password: string; code?: string }): Promise<Result<void>>;
  /** Gives a Google-only account a password. */
  setPassword(input: { newPassword: string }): Promise<Result<void>>;
  /**
   * Moving 2FA to a new phone, step 1: re-authenticates (password, unless Google-only, plus a
   * current or recovery code) and returns the new phone's otpauth URI. 2FA stays on throughout.
   */
  startTwoFactorMove(input: {
    password?: string;
    code: string;
  }): Promise<Result<{ totpURI: string }>>;
  /** Step 2: a code from the new phone swaps it in; returns the new recovery codes. */
  confirmTwoFactorMove(input: { code: string }): Promise<Result<{ backupCodes: string[] }>>;
  /** Discards the pending new phone; the current one keeps working. */
  cancelTwoFactorMove(): Promise<Result<void>>;
  /** Uploads (or replaces) the signed-in user's profile picture; returns its new URL. */
  uploadAvatar(file: Blob): Promise<Result<{ avatarUrl: string }>>;
  /** Removes the profile picture; the default picture shows again. */
  removeAvatar(): Promise<Result<void>>;
}

export const MESSAGES = {
  badCredentials: 'Email or password is incorrect',
  tooMany: 'Too many attempts, wait a minute and try again',
  locked: 'Too many wrong codes. Two-step verification is locked for 15 minutes, try again later',
  newChallenge: 'Too many wrong codes. Sign in again to get a fresh attempt',
  challengeExpired: 'Your sign-in has expired. Sign in again',
  sessionExpired: 'Your session has expired — sign in again',
  badCode: 'That code is incorrect',
  badRecoveryCode: 'That recovery code is incorrect or has already been used',
  badPassword: 'Password is incorrect',
  emailTaken: 'An account with this email already exists',
  invalidReset: 'Email or code is incorrect',
  exportLimited: 'This tree was exported several times just now. Try again in a little while.',
  exportTooLarge: 'This tree has too many photos to export as one file.',
  checkDetails: 'Check the details and try again',
  network: 'Cannot reach the server, check your connection and try again',
  unknown: 'Something went wrong, try again',
  quota: 'You’ve reached the limit of trees you can own',
  twoFactorRequired: 'Two-step verification needs to be on for this',
  twoFactorForRole: 'Tree owners and branch stewards must keep two-step verification on',
  ownsTrees: 'Transfer or delete the trees you own before deleting your account',
  passwordRequired: 'Enter your password',
  weakPassword: PASSWORD_CLASSES_MESSAGE,
  invalidInvite: 'This invite link is invalid, expired or already used',
  resetNotAllowed:
    'You can only issue a reset link to a member without two-step verification who belongs only to trees you own',
  forbidden: 'You don’t have permission to do that',
  notFound: 'This tree doesn’t exist or you don’t have access to it',
  conflict: 'That already exists',
  itemGone: 'That item no longer exists. Refresh and try again.',
  staleEdit:
    'Someone else changed this person while you were editing. Load the latest version and make your change again.',
  restoreConflict:
    'This can’t be restored because the family has changed since it was deleted. You can erase it instead.',
  alreadyRelated: 'They are already related this way',
  personClaimed: 'Someone else in this tree is already linked to that person',
  alreadyLinked: 'You’re already linked to someone in this tree',
  alreadyChild: 'They are already a child of those parents.',
  trashOwnerOnly: 'Only the tree owner can open the Trash',
  photoType: 'Use a JPEG, PNG or WebP photo.',
  photoTooLarge: 'Photos can be at most 10 MB.',
  photoDimensions: 'This photo has too many pixels. Use one of at most 50 megapixels.',
  photoUnreadable: 'This photo couldn’t be read. Try another file.',
  photoTooMany: 'This person already has 50 photos. Remove one first.',
  avatarTooLarge: 'Profile pictures can be at most 5 MB.',
  avatarBusy: 'Too many photos are being processed, try again shortly.',
  photoQuota: 'This tree has used all of its photo storage. Remove some photos first.',
  searchFailed: 'Search isn’t available right now. Try again.',
  noRelationship: 'They aren’t connected in this tree.',
  personNotFound: 'This person doesn’t exist or has been deleted',
  deleteNotAllowed: 'This includes people outside your branch. Ask the owner to delete it.',
  itemChanged: 'That changed in the meantime. Reload and try again.',
  layoutFailed: 'The tree couldn’t be drawn. Try the focus view, or reload the page.',
  layoutTooSlow: 'Layout is taking too long — try a smaller view.',
  googleEmailTaken:
    'An account with this email already exists. Sign in with your password, then connect Google in Account settings.',
  googleLinkedElsewhere: 'That Google account is already connected to another Family Tree account.',
  googleCancelled: 'Google sign-in was cancelled.',
  googleFailed: 'Google sign-in didn’t work. Try again.',
  googleConnectFailed: 'Google couldn’t be connected. Try again.',
  googleUnavailable: 'Google sign-in isn’t available right now.',
  googleAlreadyConnected: 'Google is already connected to this account.',
  googleNotConnected: 'Google isn’t connected to this account.',
  codeRequired: 'Enter the 6-digit code from your authenticator app, or a recovery code.',
  passwordRequiredToDisconnect: 'Set a password first, so you can still sign in without Google.',
  passwordAlreadySet: 'This account already has a password.',
  twoFactorNotEnabled: 'Two-step verification is off, so there is nothing to move.',
  moveNotStarted: 'This move is no longer waiting for a code. Start again.',
  moveExpired: 'That took longer than 10 minutes, so the new phone wasn’t added. Start again.',
  moveRecentSignIn:
    'To move two-step verification, confirm it’s you: sign in with Google again, then try once more.',
  recentSignInRequired:
    'To set a password, confirm it’s you: sign in with Google again, then try once more.',
} as const;

/** The error code AuthProvider reacts to by re-reading the session. */
export const SESSION_EXPIRED = 'SESSION_EXPIRED';

/** Friendly messages for known error codes (Better Auth's BASE_ERROR_CODES / TWO_FACTOR_ERROR_CODES, and ours). */
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
  INVALID_RESET: MESSAGES.invalidReset,
  QUOTA_EXCEEDED: MESSAGES.quota,
  TWO_FACTOR_REQUIRED: MESSAGES.twoFactorRequired,
  TWO_FACTOR_REQUIRED_FOR_ROLE: MESSAGES.twoFactorForRole,
  OWNS_TREES: MESSAGES.ownsTrees,
  PASSWORD_REQUIRED: MESSAGES.passwordRequired,
  WEAK_PASSWORD: MESSAGES.weakPassword,
  INVALID_INVITE: MESSAGES.invalidInvite,
  RESET_LINK_NOT_ALLOWED: MESSAGES.resetNotAllowed,
  FORBIDDEN: MESSAGES.forbidden,
  NOT_FOUND: MESSAGES.notFound,
  CONFLICT: MESSAGES.conflict,
  PERSON_CLAIMED: MESSAGES.personClaimed,
  ALREADY_LINKED: MESSAGES.alreadyLinked,
  TWO_FACTOR_CODE_REQUIRED: MESSAGES.codeRequired,
  GOOGLE_ALREADY_CONNECTED: MESSAGES.googleAlreadyConnected,
  GOOGLE_NOT_CONNECTED: MESSAGES.googleNotConnected,
  PASSWORD_REQUIRED_TO_DISCONNECT: MESSAGES.passwordRequiredToDisconnect,
  PASSWORD_ALREADY_SET: MESSAGES.passwordAlreadySet,
  RECENT_SIGN_IN_REQUIRED: MESSAGES.recentSignInRequired,
  PROVIDER_NOT_FOUND: MESSAGES.googleUnavailable,
  TWO_FACTOR_NOT_ENABLED: MESSAGES.twoFactorNotEnabled,
  MOVE_NOT_STARTED: MESSAGES.moveNotStarted,
  MOVE_EXPIRED: MESSAGES.moveExpired,
};

/** Error codes Better Auth puts in ?error= when a Google round trip fails. */
const GOOGLE_CALLBACK_ERRORS: Record<string, string> = {
  account_not_linked: MESSAGES.googleEmailTaken,
  account_already_linked_to_different_user: MESSAGES.googleLinkedElsewhere,
  access_denied: MESSAGES.googleCancelled,
  // Ours (auth/google.ts guardLinkRace): another tab connected a Google account first.
  google_already_connected: MESSAGES.googleAlreadyConnected,
};

/**
 * The message for a `?error=` code after a Google round trip (null when there's none). The code
 * comes from the URL, so anything unrecognised gets a fixed fallback, never the code itself.
 */
export function googleErrorMessage(
  code: string | null,
  action: 'signIn' | 'connect' = 'signIn',
): string | null {
  if (!code) return null;
  return (
    GOOGLE_CALLBACK_ERRORS[code] ??
    (action === 'connect' ? MESSAGES.googleConnectFailed : MESSAGES.googleFailed)
  );
}

/** The only place a Google round trip may send the browser. */
const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com';

/**
 * What a call depends on, which decides what a bare 401 means:
 * - `signIn`: the email and password were wrong;
 * - `challenge`: the half-finished 2FA sign-in has expired;
 * - `session`: the signed-in session has expired;
 * - `public`: nothing; a 401 is unexpected.
 */
export type CallKind = 'signIn' | 'challenge' | 'session' | 'public';

/**
 * Turns a status and an error code into a message for people. Server text is never shown:
 * anything unrecognised gets a generic message.
 */
export function toAuthError(status: number, code?: string, kind: CallKind = 'public'): AuthError {
  if (code && BY_CODE[code]) return { code, message: BY_CODE[code] };
  const resolvedCode = code || (status === 429 ? 'RATE_LIMITED' : `HTTP_${status}`);
  if (status === 429) return { code: resolvedCode, message: MESSAGES.tooMany };
  if (status === 401) {
    if (kind === 'signIn') return { code: resolvedCode, message: MESSAGES.badCredentials };
    if (kind === 'challenge') return { code: resolvedCode, message: MESSAGES.challengeExpired };
    if (kind === 'session') return { code: SESSION_EXPIRED, message: MESSAGES.sessionExpired };
  }
  if (status >= 400 && status < 500) return { code: resolvedCode, message: MESSAGES.checkDetails };
  return { code: resolvedCode, message: MESSAGES.unknown };
}

const networkError = (): Result<never> => ({
  ok: false,
  error: { code: 'NETWORK', message: MESSAGES.network },
});

type BetterAuthResult<T> = {
  data: T | null;
  error: { status: number; code?: string } | null;
};

async function run<T, R>(
  kind: CallKind,
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
    return { ok: false, error: toAuthError(res.error.status, res.error.code, kind) };
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

  async function v1Error(res: Response, kind: CallKind = 'public'): Promise<Result<never>> {
    const body: unknown = await res.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(body);
    const err = parsed.success ? parsed.data.error : undefined;
    return { ok: false, error: toAuthError(res.status, err?.code, kind) };
  }

  /** An upload refusal as a fixed message, by the server's `details.reason`. */
  async function avatarError(res: Response): Promise<Result<never>> {
    const body: unknown = await res.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(body);
    const err = parsed.success ? parsed.data.error : undefined;
    const reason = (err?.details as { reason?: unknown } | undefined)?.reason;
    const byReason: Record<string, string> = {
      type: MESSAGES.photoType,
      tooLarge: MESSAGES.avatarTooLarge,
      dimensions: MESSAGES.photoDimensions,
      unreadable: MESSAGES.photoUnreadable,
    };
    if (err?.code === 'VALIDATION' && typeof reason === 'string' && byReason[reason]) {
      return { ok: false, error: { code: 'VALIDATION', message: byReason[reason] } };
    }
    if (res.status === 503)
      return { ok: false, error: { code: 'BUSY', message: MESSAGES.avatarBusy } };
    return { ok: false, error: toAuthError(res.status, err?.code, 'session') };
  }

  async function v1Post(
    path: string,
    body: unknown,
    kind: CallKind = 'public',
  ): Promise<Result<void>> {
    const res = await v1(path, { method: 'POST', body });
    if (!res) return networkError();
    if (!res.ok) return v1Error(res, kind);
    return { ok: true, data: undefined };
  }

  /** POSTs JSON and parses a successful answer with `schema` (anything else is a failure). */
  async function v1PostFor<T>(
    path: string,
    body: unknown,
    schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  ): Promise<Result<T>> {
    const res = await v1(path, { method: 'POST', body });
    if (!res) return networkError();
    if (!res.ok) return v1Error(res, 'session');
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { ok: false, error: toAuthError(500) };
    return { ok: true, data: parsed.data };
  }

  /** Asks Better Auth for Google's authorization URL, then leaves the page for it. */
  async function goToGoogle(
    kind: CallKind,
    path: '/sign-in/social' | '/link-social',
    body: Record<string, unknown>,
  ): Promise<Result<void>> {
    const res = await run(
      kind,
      () =>
        client.$fetch<{ url?: unknown }>(path, {
          method: 'POST',
          body: { provider: 'google', ...body, disableRedirect: true },
        }) as Promise<BetterAuthResult<{ url?: unknown }>>,
      (data) => data?.url,
    );
    if (!res.ok) return res;
    const url = res.data;
    if (typeof url !== 'string' || !url.startsWith(`${GOOGLE_AUTH_ORIGIN}/`)) {
      return { ok: false, error: toAuthError(200) };
    }
    leavePage.to(url);
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
      run('public', () => client.signUp.email({ name, email, password }), nothing),
    signIn: ({ email, password }) =>
      run(
        'signIn',
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
      run('challenge', () => client.twoFactor.verifyTotp({ code, trustDevice }), nothing),
    verifyRecoveryCode: ({ code }) =>
      run('challenge', () => client.twoFactor.verifyBackupCode({ code }), nothing),
    signOut: () => run('public', () => client.signOut(), nothing),
    startTwoFactorSetup: ({ password }) =>
      run(
        'session',
        () => client.twoFactor.enable({ password, method: 'totp' }),
        (data) =>
          'totpURI' in data
            ? { totpURI: data.totpURI, backupCodes: data.backupCodes }
            : { totpURI: '', backupCodes: [] },
      ),
    confirmTwoFactorSetup: ({ code }) =>
      run('session', () => client.twoFactor.verifyTotp({ code }), nothing),
    regenerateRecoveryCodes: ({ password }) =>
      run(
        'session',
        () => client.twoFactor.generateBackupCodes({ password }),
        (data) => data.backupCodes,
      ),
    disableTwoFactor: ({ password }) =>
      run('session', () => client.twoFactor.disable({ password }), nothing),
    changePassword: ({ currentPassword, newPassword }) =>
      run(
        'session',
        () => client.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }),
        nothing,
      ),
    resetWithCode: (input) => v1Post('/password-reset/totp', input),
    resetWithLink: (input) => v1Post('/password-reset/link', input),
    deleteAccount: ({ password }) => run('session', () => client.deleteUser({ password }), nothing),
    async getProviders() {
      const none = { ok: true as const, data: { google: false } };
      const res = await v1('/auth/providers');
      if (!res?.ok) return none;
      const parsed = authProvidersSchema.safeParse(await res.json().catch(() => null));
      return parsed.success ? { ok: true, data: parsed.data } : none;
    },
    startGoogleSignIn: ({ next }) => {
      // The server accepts only absolute URLs on this site; it redirects to them afterwards.
      const here = window.location.origin;
      const path = safeNext(next);
      return goToGoogle('public', '/sign-in/social', {
        callbackURL: `${here}${path}`,
        errorCallbackURL: `${here}/sign-in${path === '/' ? '' : `?next=${encodeURIComponent(path)}`}`,
      });
    },
    connectGoogle: ({ password, code }) => {
      const here = window.location.origin;
      return goToGoogle('session', '/link-social', {
        password,
        ...(code ? { code } : {}),
        callbackURL: `${here}/account/google?google=connected`,
        errorCallbackURL: `${here}/account/google`,
      });
    },
    disconnectGoogle: (input) => v1Post('/account/google/disconnect', input, 'session'),
    setPassword: (input) => v1Post('/account/password', input, 'session'),
    startTwoFactorMove: (input) =>
      v1PostFor('/account/two-factor/move/start', input, twoFactorMoveStartedSchema),
    confirmTwoFactorMove: (input) =>
      v1PostFor('/account/two-factor/move/confirm', input, twoFactorMovedSchema),
    cancelTwoFactorMove: () => v1Post('/account/two-factor/move/cancel', {}, 'session'),
    uploadAvatar: async (file) => {
      let res: Response;
      try {
        res = await fetch(`${origin}/api/v1/account/avatar`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': file.type || 'application/octet-stream' },
          body: file,
        });
      } catch {
        return networkError();
      }
      if (!res.ok) return avatarError(res);
      const parsed = avatarResponseSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) return { ok: false, error: toAuthError(500) };
      return { ok: true, data: parsed.data };
    },
    removeAvatar: async () => {
      let res: Response;
      try {
        res = await fetch(`${origin}/api/v1/account/avatar`, {
          method: 'DELETE',
          credentials: 'include',
        });
      } catch {
        return networkError();
      }
      if (!res.ok) return v1Error(res, 'session');
      return { ok: true, data: undefined };
    },
  };
}
