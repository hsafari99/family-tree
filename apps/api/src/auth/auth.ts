import { PASSWORD_MAX, PASSWORD_MIN } from '@family-tree/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { accounts, sessions, twoFactors, users, verifications } from '../db/schema.js';
import { CLIENT_IP_HEADER } from './fastify-adapter.js';
import { hashPassword, verifyPassword } from './password.js';

export interface AuthOptions {
  config: Config;
  db: Db;
  /** Tests can turn Better Auth's own rate limiter off. */
  rateLimitEnabled?: boolean;
}

export function createAuth({ config, db, rateLimitEnabled = true }: AuthOptions) {
  return betterAuth({
    appName: 'Family Tree',
    baseURL: config.AUTH_BASE_URL,
    basePath: '/api/auth',
    secret: config.SESSION_SECRET,
    trustedOrigins: [config.WEB_ORIGIN],
    telemetry: { enabled: false },
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
    plugins: [twoFactor({ issuer: 'Family Tree', backupCodeOptions: { amount: 8 } })],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthUser = Auth['$Infer']['Session']['user'];
