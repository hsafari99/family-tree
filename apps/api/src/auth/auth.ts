import {
  PASSWORD_CLASSES_MESSAGE,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordSchema,
} from '@family-tree/shared';
import { betterAuth } from 'better-auth';
import { eq } from 'drizzle-orm';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { safeError } from '../errors.js';
import { drainStorageDeletions, queueObjectDeletes } from '../storage/deletions.js';
import type { ObjectStore } from '../storage/objects.js';
import { accounts, sessions, twoFactors, users, verifications } from '../db/schema.js';
import { CLIENT_IP_HEADER } from './fastify-adapter.js';
import { holdsTwoFactorRole, ownsLiveTree } from '../trees/roles.js';
import {
  blockUnlinkEndpoint,
  challengeSocialSignIn,
  checkSocialStart,
  confirmLink,
  guardLinkRace,
} from './google.js';
import { hashPassword, verifyPassword } from './password.js';
import { TWO_FACTOR_LOCK_SECONDS, TWO_FACTOR_MAX_FAILED_ATTEMPTS } from './totp-reset.js';
import { RECOVERY_CODE_COUNT, TWO_FACTOR_ISSUER } from './two-factor-move.js';

type AuthLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Where Better Auth's log messages go: a pino logger (app.log or a child) fits. */
export type AuthLogSink = Record<AuthLogLevel, (obj: object, msg: string) => void>;

export interface AuthOptions {
  config: Config;
  db: Db;
  /** Tests can force Better Auth's own rate limiter on or off; default: AUTH_RATE_LIMIT_ENABLED. */
  rateLimitEnabled?: boolean;
  /** Better Auth logs here instead of the console. */
  log?: AuthLogSink;
  /** Deletes a deleted account's profile picture straight away; without it the outbox does. */
  storage?: ObjectStore;
}

/**
 * A sink that forwards to a logger attached later. The auth instance is built before the
 * Fastify app (and its logger) exists, so server.ts attaches app.log once it does; until
 * then, warnings and errors go to the console.
 */
export function createAuthLogBridge() {
  let target: AuthLogSink | undefined;
  const forward =
    (level: AuthLogLevel) =>
    (obj: object, msg: string): void => {
      if (target) target[level](obj, msg);
      else if (level === 'error' || level === 'warn') console[level](msg, obj);
    };
  const sink: AuthLogSink = {
    debug: forward('debug'),
    info: forward('info'),
    warn: forward('warn'),
    error: forward('error'),
  };
  return {
    sink,
    attach: (logger: AuthLogSink) => {
      target = logger;
    },
  };
}

function authLogLevel(level: Config['LOG_LEVEL']): AuthLogLevel {
  if (level === 'trace' || level === 'debug') return 'debug';
  if (level === 'info' || level === 'warn') return level;
  return 'error';
}

const serialiseArg = (arg: unknown) => {
  const safe = safeError(arg);
  return safe instanceof Error
    ? { name: safe.name, message: safe.message, stack: safe.stack }
    : safe;
};

export function createAuth({ config, db, rateLimitEnabled, log, storage }: AuthOptions) {
  // A deleted account's profile picture: read before the delete (the row is gone afterwards),
  // queued for deletion only once the account is really gone.
  const avatarsOfDeleted = new Map<string, string>();
  return betterAuth({
    appName: 'Family Tree',
    baseURL: config.AUTH_BASE_URL,
    basePath: '/api/auth',
    secret: config.SESSION_SECRET,
    trustedOrigins: [config.WEB_ORIGIN],
    telemetry: { enabled: false },
    logger: {
      disabled: config.LOG_LEVEL === 'silent',
      level: authLogLevel(config.LOG_LEVEL),
      ...(log
        ? {
            log: (level: AuthLogLevel, message: string, ...args: unknown[]) =>
              log[level](args.length > 0 ? { betterAuth: args.map(serialiseArg) } : {}, message),
          }
        : {}),
    },
    database: guardLinkRace(
      drizzleAdapter(db, {
        provider: 'pg',
        schema: {
          user: users,
          session: sessions,
          account: accounts,
          verification: verifications,
          twoFactor: twoFactors,
        },
      }),
      config.WEB_ORIGIN,
    ),
    // Spec §5: Google sign-in, only when the OAuth client is configured. Google's defaults are
    // exactly openid, email and profile; include_granted_scopes is off so no earlier grant to
    // this client is folded in.
    socialProviders: config.google
      ? {
          google: {
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
            includeGrantedScopes: false,
            prompt: 'select_account',
          },
        }
      : {},
    account: {
      accountLinking: {
        // Spec §5: emails are never verified, so anyone could pre-register a victim's address.
        // A Google sign-in must never attach itself to an existing account by email; linking
        // happens only from Account settings, signed in (see google.ts).
        disableImplicitLinking: true,
        // Linking is explicit and re-authenticated, so the Google address may differ from the
        // login name (which is only a name here).
        allowDifferentEmails: true,
        updateUserInfoOnLink: false,
      },
    },
    // OAuth failures land on the web sign-in page (?error=<code>), which shows a fixed message.
    onAPIError: { errorURL: `${config.WEB_ORIGIN}/sign-in` },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      autoSignIn: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    user: {
      deleteUser: {
        enabled: true,
        // Spec §5: transfer or delete owned trees first.
        beforeDelete: async (user) => {
          if (await ownsLiveTree(db, user.id)) {
            throw APIError.from('FORBIDDEN', {
              code: 'OWNS_TREES',
              message: 'Transfer or delete the trees you own first',
            });
          }
          const [row] = await db
            .select({ key: users.avatarKey })
            .from(users)
            .where(eq(users.id, user.id));
          if (row?.key) avatarsOfDeleted.set(user.id, row.key);
        },
        afterDelete: async (user) => {
          const key = avatarsOfDeleted.get(user.id);
          if (!key) return;
          avatarsOfDeleted.delete(user.id);
          await queueObjectDeletes(db, [key]);
          if (!storage) return;
          try {
            await drainStorageDeletions(db, storage, { keys: [key] });
          } catch (err) {
            log?.error({ err: safeError(err) }, 'avatar delete failed; the key stays queued');
          }
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        checkSocialStart(ctx, config.WEB_ORIGIN);
        blockUnlinkEndpoint(ctx);
        await confirmLink(ctx, db);
        checkNewPassword(ctx);
        // Without a password Better Auth deletes any session younger than a day unchecked.
        if (ctx.path === '/delete-user' || ctx.path === '/delete-user/callback') {
          const password = (ctx.body as { password?: unknown } | undefined)?.password;
          if (typeof password !== 'string' || password === '') {
            throw APIError.from('BAD_REQUEST', {
              code: 'PASSWORD_REQUIRED',
              message: 'Enter your password',
            });
          }
        }
        // Spec §5: owners and stewards can't turn 2FA off.
        if (ctx.path === '/two-factor/disable') {
          const session = await getSessionFromCtx(ctx);
          if (session && (await holdsTwoFactorRole(db, session.user.id))) {
            throw APIError.from('FORBIDDEN', {
              code: 'TWO_FACTOR_REQUIRED_FOR_ROLE',
              message: 'Tree owners and stewards must keep two-step verification on',
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        await challengeSocialSignIn(ctx, config.WEB_ORIGIN);
      }),
    },
    emailVerification: { sendOnSignUp: false },
    // cookieCache stays off: with it, a revoked session would keep working until the cache expires.
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: rateLimitEnabled ?? config.AUTH_RATE_LIMIT_ENABLED,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60 * 60, max: 10 },
        '/sign-in/social': { window: 60, max: 10 },
        // Checks the password and second factor (google.ts), like /change-password.
        '/link-social': { window: 60 * 15, max: 5 },
        '/two-factor/*': { window: 60, max: 5 },
        '/change-password': { window: 60 * 15, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: 'ft',
      useSecureCookies: config.NODE_ENV === 'production',
      database: { generateId: 'uuid' },
      // The adapter puts Fastify's request.ip (proxy-aware only when TRUST_PROXY > 0) in this
      // header, so a client can't spoof X-Forwarded-For to dodge rate limits.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      // Better Auth skips origin/CSRF checks when NODE_ENV=test unless this is set explicitly.
      disableOriginCheck: false,
    },
    // Spec §5: 8 one-time recovery codes. Better Auth stores them encrypted (the spec said
    // hashed; encrypted is accepted).
    // Spec §5: lock 2FA for 15 minutes after 5 consecutive failures (Better Auth's default is 10).
    plugins: [
      twoFactor({
        issuer: TWO_FACTOR_ISSUER,
        backupCodeOptions: { amount: RECOVERY_CODE_COUNT },
        accountLockout: {
          maxFailedAttempts: TWO_FACTOR_MAX_FAILED_ATTEMPTS,
          durationSeconds: TWO_FACTOR_LOCK_SECONDS,
        },
      }),
    ],
  });
}

/** Better Auth endpoints that set a new password, and the body field that carries it. */
const NEW_PASSWORD_FIELD: Record<string, string> = {
  '/sign-up/email': 'password',
  '/change-password': 'newPassword',
  '/reset-password': 'newPassword',
  // Server-only (the account route calls it after its own check), covered all the same.
  '/set-password': 'newPassword',
};

/** Better Auth only checks the length: the shared rule (a capital, a number and a symbol) is
 *  checked here, so calling these endpoints directly can't skip it. Sign-in never checks it. */
function checkNewPassword(ctx: { path: string; body?: unknown }) {
  const field = NEW_PASSWORD_FIELD[ctx.path];
  if (!field) return;
  const value = (ctx.body as Record<string, unknown> | undefined)?.[field];
  // A missing or non-string value is left to Better Auth's own validation.
  if (typeof value !== 'string') return;
  const issues = passwordSchema.safeParse(value).error?.issues ?? [];
  if (issues.some((i) => i.message === PASSWORD_CLASSES_MESSAGE)) {
    throw APIError.from('BAD_REQUEST', {
      code: 'WEAK_PASSWORD',
      message: PASSWORD_CLASSES_MESSAGE,
    });
  }
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthUser = Auth['$Infer']['Session']['user'];
