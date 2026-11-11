import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { createAuth, createAuthLogBridge } from './auth/auth.js';
import type { Config } from './config.js';
import { createDb } from './db/client.js';
import type { HealthChecks } from './routes/health.js';
import { createObjectStore } from './storage/objects.js';
import { createS3 } from './storage/s3.js';

export function createDeps(config: Config) {
  const { db, sql } = createDb(config.DATABASE_URL);
  const s3 = createS3(config);
  const storage = createObjectStore(config, s3);
  const authLog = createAuthLogBridge();
  const auth = createAuth({ config, db, log: authLog.sink, storage });
  const checks: HealthChecks = {
    checkDb: async () => {
      await sql`select 1`;
    },
    checkStorage: async () => {
      await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    },
  };
  return {
    db,
    sql,
    s3,
    storage,
    auth,
    /** Sends Better Auth's logs to this logger (server.ts passes a child of app.log). */
    attachAuthLogger: authLog.attach,
    checks,
    close: async () => {
      await sql.end({ timeout: 5 });
      storage.close();
      s3.destroy();
    },
  };
}

export type Deps = ReturnType<typeof createDeps>;
