import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { SEED_TREE_NAME, seedSampleFamily } from './seed.js';

const config = loadConfig();
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
