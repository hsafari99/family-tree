import { createAuthMiddleware, getOAuthState } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import { generateRandomString } from 'better-auth/crypto';

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
