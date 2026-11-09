import { z } from 'zod';

/** Every committed dev value contains this marker so production can refuse it. */
export const DEV_ONLY_MARKER = 'dev-only';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', 's3']);

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    WEB_ORIGIN: z.url(),
    SESSION_SECRET: z.string().min(32),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default(false),
    S3_CREATE_BUCKET: bool.default(false),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.includes(DEV_ONLY_MARKER)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Development value not allowed in production',
        });
      }
    }
    for (const key of ['S3_ENDPOINT', 'WEB_ORIGIN'] as const) {
      const url = new URL(config[key]);
      if (url.protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Must use https in production' });
      }
      if (LOCAL_HOSTS.has(url.hostname)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Must not point to a local host in production',
        });
      }
    }
    if (config.S3_CREATE_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_CREATE_BUCKET'],
        message: 'Must be false in production',
      });
    }
  });

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
