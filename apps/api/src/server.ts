import { buildApp } from './app.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createDeps } from './deps.js';
import { ensureBucket } from './storage/s3.js';

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
await runMigrations(deps.db);
if (config.S3_CREATE_BUCKET) await ensureBucket(deps.s3, config.S3_BUCKET);

const app = buildApp({ config, checks: deps.checks });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await deps.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
