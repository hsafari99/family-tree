// Purges trees deleted more than 30 days ago, once. The API does this hourly on its own; this
// is for a manual run. Dev: pnpm purge-trees. Production: node dist/trees/purge-cli.js
import { ConfigError, type Config, loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { drainStorageDeletions } from '../storage/deletions.js';
import { createObjectStore } from '../storage/objects.js';
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
const store = createObjectStore(config);
try {
  const { ids, busy } = await purgeDeletedTrees(db);
  if (busy)
    console.log(
      `Another purge is running.${ids.length > 0 ? ` This run purged ${ids.length} tree(s) first.` : ''}`,
    );
  else console.log(`Purged ${ids.length} deleted tree(s).`);
  let deleted = 0;
  let failed = 0;
  for (;;) {
    const r = await drainStorageDeletions(db, store);
    deleted += r.deleted;
    failed += r.failed;
    if (r.deleted + r.failed < 500 || r.failed > 0) break;
  }
  console.log(`Deleted ${deleted} stored object(s); ${failed} failed and will be retried.`);
} finally {
  store.close();
  await sql.end();
}
