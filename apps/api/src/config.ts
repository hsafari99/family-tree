import { z } from 'zod';

/** Every committed dev value contains this marker so production can refuse it. */
export const DEV_ONLY_MARKER = 'dev-only';
/** Markers (compared case-insensitively) that must never reach production. */
const FORBIDDEN_IN_PRODUCTION = [DEV_ONLY_MARKER, 'change_me'];
const LOCAL_HOSTS = new Set(['localhost', '::1', '[::1]', '0.0.0.0', 's3', 'host.docker.internal']);

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return LOCAL_HOSTS.has(host) || host.startsWith('127.') || host.endsWith('.localhost');
}

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
// Browsers send Origin without path or trailing slash; anything else silently breaks CORS.
const bareOrigin = () =>
  z
    .url()
    .refine(
      (u) => URL.canParse(u) && new URL(u).origin === u,
      'Must be a bare origin, e.g. https://example.com',
    );

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    WEB_ORIGIN: bareOrigin(),
    // Public origin Better Auth builds its URLs from (it appends /api/auth itself).
    AUTH_BASE_URL: bareOrigin(),
    // Number of trusted proxy hops in front of the API (0 = none). The client IP is taken that
    // many hops from the right of X-Forwarded-For, so extra entries a client adds are ignored.
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    // Spec §3: how many non-deleted trees one user may own.
    MAX_TREES_PER_USER: z.coerce.number().int().min(1).max(100).default(3),
    // How often the API purges trees deleted more than TREE_RESTORE_DAYS ago (0 = never).
    TREE_PURGE_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(10_080).default(60),
    // Spec §10: migrations run at startup. Production runs them in the one-shot `migrate`
    // service as the owner role, so the API itself runs as a role without DDL rights.
    MIGRATE_ON_START: bool.default(true),
    // Better Auth's sign-in, sign-up and 2FA limits. Only the E2E dev stack turns them off.
    AUTH_RATE_LIMIT_ENABLED: bool.default(true),
    SESSION_SECRET: z.string().min(32),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    // Unset: false, except in production, where it is true (see the check below).
    S3_FORCE_PATH_STYLE: bool.optional(),
    S3_CREATE_BUCKET: bool.default(false),
    // Where browsers fetch photos from (signed URLs); defaults to S3_ENDPOINT. Differs in dev,
    // where the API reaches SeaweedFS as http://s3:8333 but the browser as http://localhost:8333.
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    // Spec §3: photo storage per tree, in bytes (default 1 GiB).
    MAX_PHOTO_BYTES_PER_TREE: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_099_511_627_776)
      .default(1_073_741_824),
  })
  .superRefine((config, ctx) => {
    // E2E only (decision 15): the auth limits may be off only for a local or .test stack.
    if (!config.AUTH_RATE_LIMIT_ENABLED && URL.canParse(config.AUTH_BASE_URL)) {
      const host = new URL(config.AUTH_BASE_URL).hostname.toLowerCase();
      if (!isLocalHost(host) && !host.endsWith('.test')) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_RATE_LIMIT_ENABLED'],
          message: 'May be false only for a local or .test AUTH_BASE_URL',
        });
      }
    }
    if (config.NODE_ENV !== 'production') return;

    for (const [key, value] of Object.entries(config)) {
      if (
        typeof value === 'string' &&
        FORBIDDEN_IN_PRODUCTION.some((marker) => value.toLowerCase().includes(marker))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Development or placeholder value not allowed in production',
        });
      }
    }
    for (const key of [
      'S3_ENDPOINT',
      'S3_PUBLIC_ENDPOINT',
      'WEB_ORIGIN',
      'AUTH_BASE_URL',
    ] as const) {
      const value = config[key];
      // Field-level errors are already reported; superRefine still runs, so don't throw here.
      if (value === undefined || !URL.canParse(value)) continue;
      const url = new URL(value);
      if (url.protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Must use https in production' });
      }
      if (isLocalHost(url.hostname)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Must not point to a local host in production',
        });
      }
    }
    if (!config.AUTH_RATE_LIMIT_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_RATE_LIMIT_ENABLED'],
        message: 'Must be true in production',
      });
    }
    // Virtual-hosted URLs (<bucket>.<account>.r2...) would be a different origin from the one
    // the web app's CSP img-src names (VITE_PHOTO_ORIGIN), so no photo would load.
    if (config.S3_FORCE_PATH_STYLE === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_FORCE_PATH_STYLE'],
        message: 'Must be true in production (R2 supports path-style URLs)',
      });
    }
    if (config.S3_CREATE_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_CREATE_BUCKET'],
        message: 'Must be false in production',
      });
    }
  })
  .transform((config) => ({
    ...config,
    S3_FORCE_PATH_STYLE: config.S3_FORCE_PATH_STYLE ?? config.NODE_ENV === 'production',
  }));

export type Config = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
