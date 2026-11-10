// Purges trees deleted more than 30 days ago, once. The API does this hourly on its own; this
// is for a manual run. Dev: pnpm purge-trees [--sweep]. Production: node dist/trees/purge-cli.js [--sweep]
import { ConfigError, type Config, loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { drainStorageDeletions } from '../storage/deletions.js';
import { createObjectStore } from '../storage/objects.js';
import { sweepOrphans } from '../storage/sweep.js';
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
  if (process.argv.slice(2).includes('--sweep')) {
    const r = await sweepOrphans(db, store, {
      log: { warn: (obj, msg) => console.warn(msg, obj) },
    });
    console.log(
      r.refused
        ? `Orphan sweep refused (${r.refused}): ${r.candidates} candidate(s) of ${r.scanned} object(s); nothing deleted.`
        : `Checked ${r.scanned} stored object(s); removed ${r.deleted} orphan(s).`,
    );
    if (r.stuck > 0) console.log(`${r.stuck} queued deletion(s) keep failing.`);
  }
} finally {
  store.close();
  await sql.end();
}
