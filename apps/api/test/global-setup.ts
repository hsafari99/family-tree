import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createDeps } from '../src/deps.js';
import { ensureBucket } from '../src/storage/s3.js';

export default async function setup() {
  const config = loadConfig();
  const deps = createDeps(config);
  try {
    await runMigrations(deps.db);
    await ensureBucket(deps.s3, config.S3_BUCKET);
  } finally {
    await deps.close();
  }
}
