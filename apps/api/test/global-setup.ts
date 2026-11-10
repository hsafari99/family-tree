import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { createDeps } from '../src/deps.js';
import { assertTestTargets } from '../src/target-guard.js';
import { ensureBucket } from '../src/storage/s3.js';

const HINT = 'Start it with: docker compose up -d --wait postgres s3';

function unavailable(service: string, url: string, err: unknown): Error {
  const reason = err instanceof Error ? err.message : String(err);
  return new Error(
    `Integration tests need ${service} at ${url}, but it is not reachable (${reason}).\n${HINT}`,
    { cause: err },
  );
}

export default async function setup() {
  const config = loadConfig();
  assertTestTargets(config);
  const deps = createDeps(config);
  try {
    try {
      await runMigrations(deps.db);
    } catch (err) {
      throw unavailable('Postgres', new URL(config.DATABASE_URL).host, err);
    }
    try {
      await ensureBucket(deps.s3, config.S3_BUCKET);
    } catch (err) {
      throw unavailable('S3 storage', config.S3_ENDPOINT, err);
    }
  } finally {
    await deps.close();
  }
}
