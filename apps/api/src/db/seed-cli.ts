import { ConfigError, type Config, loadConfig } from '../config.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { SEED_TREE_NAME, seedSampleFamily } from './seed.js';

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
if (config.NODE_ENV === 'production') {
  console.error('Refusing to seed sample data in production.');
  process.exit(1);
}

const { db, sql } = createDb(config.DATABASE_URL);
try {
  await runMigrations(db);
  const { treeId } = await seedSampleFamily(db);
  console.log(`Seeded "${SEED_TREE_NAME}" (tree ${treeId})`);
} finally {
  await sql.end();
}
