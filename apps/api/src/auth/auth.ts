import { PASSWORD_MAX, PASSWORD_MIN } from '@family-tree/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { accounts, sessions, twoFactors, users, verifications } from '../db/schema.js';
import { CLIENT_IP_HEADER } from './fastify-adapter.js';
import { hashPassword, verifyPassword } from './password.js';

type AuthLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Where Better Auth's log messages go: a pino logger (app.log or a child) fits. */
export type AuthLogSink = Record<AuthLogLevel, (obj: object, msg: string) => void>;

export interface AuthOptions {
  config: Config;
  db: Db;
  /** Tests can turn Better Auth's own rate limiter off. */
  rateLimitEnabled?: boolean;
  /** Better Auth logs here instead of the console. */
  log?: AuthLogSink;
}

/** Spec §5: lock 2FA after this many consecutive failures (shared with the code-reset route). */
export const TWO_FACTOR_MAX_FAILED_ATTEMPTS = 5;
/** Better Auth's default lock duration (accountLockout.durationSeconds), stated explicitly. */
export const TWO_FACTOR_LOCK_SECONDS = 15 * 60;

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

const serialiseArg = (arg: unknown) =>
  arg instanceof Error ? { name: arg.name, message: arg.message, stack: arg.stack } : arg;

export function createAuth({ config, db, rateLimitEnabled = true, log }: AuthOptions) {
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
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        twoFactor: twoFactors,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      autoSignIn: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    emailVerification: { sendOnSignUp: false },
    // cookieCache stays off: with it, a revoked session would keep working until the cache expires.
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: rateLimitEnabled,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60 * 60, max: 10 },
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
        issuer: 'Family Tree',
        backupCodeOptions: { amount: 8 },
        accountLockout: {
          maxFailedAttempts: TWO_FACTOR_MAX_FAILED_ATTEMPTS,
          durationSeconds: TWO_FACTOR_LOCK_SECONDS,
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthUser = Auth['$Infer']['Session']['user'];
