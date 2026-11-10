import { buildApp } from './app.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createDeps } from './deps.js';
import { ensureBucket } from './storage/s3.js';
import { startPurgeJob } from './trees/purge.js';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const deps = createDeps(config);
// Production migrates in the one-shot `migrate` service as the owner role (decision 12).
if (config.MIGRATE_ON_START) await runMigrations(deps.db);
if (config.S3_CREATE_BUCKET) await ensureBucket(deps.s3, config.S3_BUCKET);

const app = buildApp({
  config,
  checks: deps.checks,
  auth: deps.auth,
  db: deps.db,
  storage: deps.storage,
});
deps.attachAuthLogger(app.log.child({ module: 'better-auth' }));

const stopPurge =
  config.TREE_PURGE_INTERVAL_MINUTES > 0
    ? startPurgeJob(
        deps.db,
        app.log.child({ module: 'purge' }),
        config.TREE_PURGE_INTERVAL_MINUTES * 60_000,
        deps.storage,
      )
    : async () => {};

const shutdown = async (signal: string) => {
  await stopPurge();
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await deps.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
