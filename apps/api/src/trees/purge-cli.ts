// Purges trees deleted more than 30 days ago, once. The API does this hourly on its own; this
// is for a manual run. Dev: pnpm purge-trees. Production: node dist/trees/purge-cli.js
import { ConfigError, type Config, loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { purgeDeletedTrees } from './purge.js';

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

const { db, sql } = createDb(config.DATABASE_URL);
try {
  const ids = await purgeDeletedTrees(db);
  console.log(`Purged ${ids.length} deleted tree(s).`);
} finally {
  await sql.end();
}
