import { and, eq } from 'drizzle-orm';
import { APIError, createAuthMiddleware, getOAuthState, getSessionFromCtx } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import { generateRandomString } from 'better-auth/crypto';
import type { Db } from '../db/client.js';
import { accounts } from '../db/schema.js';
import { type TwoFactorKey, verifyAndConsumeSecondFactor } from './totp-reset.js';

export const GOOGLE_PROVIDER_ID = 'google';

/** The context Better Auth hands to `hooks.before` / `hooks.after`. */
export type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * The path, query and hash of `value` when it is an absolute URL on the web app's origin;
 * otherwise null. Return paths are only ever followed through this, so a crafted
 * callbackURL can't send the browser to another site.
 */
export function safeWebPath(value: unknown, webOrigin: string): string | null {
  // Browsers drop tabs and newlines from URLs and treat "\" like "/", so either could turn a
  // path into "//evil.example".
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || /[\u0000-\u001F\u007F\\]/.test(value)) return null;
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.origin !== webOrigin || url.username !== '' || url.password !== '') return null;
  if (url.pathname.startsWith('//')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Endpoints that start a Google round trip: sign-in, and linking from Account settings. */
const SOCIAL_START_PATHS = new Set(['/sign-in/social', '/link-social']);

const invalidCallback = () =>
  APIError.from('BAD_REQUEST', { code: 'INVALID_CALLBACK_URL', message: 'Invalid callback URL' });

/**
 * Before a Google round trip starts: every URL Better Auth will redirect to afterwards must be
 * an absolute URL on the web origin with a safe path (Better Auth itself also accepts relative
 * paths, which would resolve against the API's origin). The id-token shortcut is refused: it
 * signs in without the redirect, and the app never uses it.
 */
export function checkSocialStart(ctx: HookContext, webOrigin: string): void {
  if (!SOCIAL_START_PATHS.has(ctx.path)) return;
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  if (body.idToken !== undefined) {
    throw APIError.from('BAD_REQUEST', {
      code: 'ID_TOKEN_SIGN_IN_DISABLED',
      message: 'Continue on the Google sign-in page',
    });
  }
  if (safeWebPath(body.callbackURL, webOrigin) === null) throw invalidCallback();
  for (const key of ['errorCallbackURL', 'newUserCallbackURL']) {
    if (body[key] !== undefined && safeWebPath(body[key], webOrigin) === null) {
      throw invalidCallback();
    }
  }
}

// Mirrors better-auth@1.7.18 plugins/two-factor/index.mjs (the hook on /sign-in/email) and
// constant.mjs. Re-check whenever better-auth is upgraded; google.int.test.ts fails if the
// challenge cookie or verification records drift from what /two-factor/verify-* expects.
const TWO_FACTOR_COOKIE_NAME = 'two_factor';
const TWO_FACTOR_CHALLENGE_SECONDS = 10 * 60;

/**
 * Spec §5: two-step verification applies to every sign-in. Better Auth's twoFactor plugin only
 * intercepts the password sign-in paths, so a Google callback would otherwise hand a 2FA user
 * a full session. For such a user this replaces that session with the plugin's own pending
 * challenge (same cookie and records), then sends the browser to the web app's verify page,
 * keeping the return path. The trusted-device shortcut is not offered: the app never sets it.
 */
export async function challengeSocialSignIn(ctx: HookContext, webOrigin: string): Promise<void> {
  if (ctx.path !== '/callback/:id') return;
  const signedIn = ctx.context.newSession;
  if (!signedIn?.user.twoFactorEnabled) return;

  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(signedIn.session.token);
  ctx.context.setNewSession(null);

  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME, {
    maxAge: TWO_FACTOR_CHALLENGE_SECONDS,
  });
  const identifier = `2fa-${generateRandomString(20)}`;
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_SECONDS * 1000);
  await ctx.context.internalAdapter.createVerificationValue({
    value: signedIn.user.id,
    identifier,
    expiresAt,
  });
  await ctx.context.internalAdapter.createVerificationValue({
    value: '0',
    identifier: `2fa-attempts-${identifier}`,
    expiresAt,
  });
  await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);

  const state = await getOAuthState();
  const next = safeWebPath(state?.callbackURL, webOrigin) ?? '/';
  throw ctx.redirect(`${webOrigin}/sign-in/verify?next=${encodeURIComponent(next)}`);
}

const fail = (status: 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN', code: string, message: string) =>
  APIError.from(status, { code, message });

/** What re-authentication needs from Better Auth's context (`ctx.context` or `auth.$context`). */
export interface ReauthContext {
  internalAdapter: {
    findCredentialAccount(userId: string): Promise<{ password?: string | null } | null>;
  };
  password: { verify(input: { hash: string; password: string }): Promise<boolean> };
  secretConfig: TwoFactorKey;
}

export type ReauthFailure = {
  code: 'PASSWORD_REQUIRED' | 'INVALID_PASSWORD' | 'TWO_FACTOR_CODE_REQUIRED' | 'INVALID_CODE';
  message: string;
};

/**
 * Connecting or disconnecting Google re-authenticates: the current password, plus an
 * authenticator or recovery code when 2FA is on, so a borrowed or stolen session can't change
 * how the account signs in. Wrong codes here don't feed Better Auth's 2FA lockout; guesses are
 * capped by the routes' rate limits (5 per 15 minutes). Returns null when it all checks out.
 */
export async function reauthenticate(
  authCtx: ReauthContext,
  db: Db,
  user: { id: string; twoFactorEnabled?: boolean | null },
  body: unknown,
): Promise<ReauthFailure | null> {
  const { password, code } = (body ?? {}) as { password?: unknown; code?: unknown };
  if (typeof password !== 'string' || password === '') {
    return { code: 'PASSWORD_REQUIRED', message: 'Enter your password' };
  }
  const credential = await authCtx.internalAdapter.findCredentialAccount(user.id);
  const valid =
    credential?.password != null &&
    (await authCtx.password.verify({ hash: credential.password, password }));
  if (!valid) return { code: 'INVALID_PASSWORD', message: 'Invalid password' };

  if (user.twoFactorEnabled) {
    if (typeof code !== 'string' || code.trim() === '') {
      return { code: 'TWO_FACTOR_CODE_REQUIRED', message: 'Enter your authenticator code' };
    }
    if (!(await verifyAndConsumeSecondFactor(db, authCtx.secretConfig, user.id, code.trim()))) {
      return { code: 'INVALID_CODE', message: 'Invalid code' };
    }
  }
  return null;
}

/**
 * "Connect Google" (POST /link-social) re-authenticates first (see reauthenticate). One Google
 * account per user. Better Auth then runs the round trip and links on the callback; its own
 * checks (the session that started the link is still live, the Google account isn't someone
 * else's) still apply.
 */
export async function confirmLink(ctx: HookContext, db: Db): Promise<void> {
  if (ctx.path !== '/link-social') return;
  // No session: let the endpoint answer 401 itself.
  const session = await getSessionFromCtx(ctx);
  if (!session) return;

  const linked = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, session.user.id), eq(accounts.providerId, GOOGLE_PROVIDER_ID)));
  if (linked.length > 0) {
    throw fail('CONFLICT', 'GOOGLE_ALREADY_CONNECTED', 'Google is already connected');
  }
  const failure = await reauthenticate(ctx.context, db, session.user, ctx.body);
  if (failure) throw fail('BAD_REQUEST', failure.code, failure.message);
}

/**
 * Better Auth's /unlink-account removes any account, including the password login, leaving
 * Google as the only way in (and it requires a session under a day old). The app unlinks
 * through POST /api/v1/account/google/disconnect instead, so this one is closed.
 */
export function blockUnlinkEndpoint(ctx: HookContext): void {
  if (ctx.path === '/unlink-account') {
    throw fail('FORBIDDEN', 'UNLINK_DISABLED', 'Use Account settings to disconnect Google');
  }
}

/** Whether `err` (or its cause) is a unique violation of the named constraint. */
function violates(err: unknown, constraint: string): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    const pg = e as { code?: unknown; constraint_name?: unknown };
    if (pg.code === '23505' && pg.constraint_name === constraint) return true;
  }
  return false;
}

/**
 * Wraps the database adapter so a "Connect Google" that loses a race (two tabs linking at once:
 * both pass the GOOGLE_ALREADY_CONNECTED check, the database's accounts_user_provider_uq stops
 * the second) ends on Account settings with a fixed message instead of a 500. Better Auth's
 * callback has no hook for database errors, so this is the one place to catch it.
 */
export function guardLinkRace<F extends (...args: never[]) => { create: unknown }>(
  factory: F,
  webOrigin: string,
): F {
  return ((...args: Parameters<F>) => {
    const adapter = factory(...args) as ReturnType<F> & {
      create: (input: { model: string; data: Record<string, unknown> }) => Promise<unknown>;
    };
    return {
      ...adapter,
      async create(input: { model: string; data: Record<string, unknown> }) {
        try {
          return await adapter.create(input);
        } catch (err) {
          if (
            input.model === 'account' &&
            input.data.providerId === GOOGLE_PROVIDER_ID &&
            violates(err, 'accounts_user_provider_uq')
          ) {
            const headers = new Headers({
              location: `${webOrigin}/account?error=google_already_connected`,
            });
            throw new APIError('FOUND', undefined, headers);
          }
          throw err;
        }
      },
    };
  }) as unknown as F;
}
