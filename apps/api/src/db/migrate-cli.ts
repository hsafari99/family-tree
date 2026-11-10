// Production: runs the migrations once, as the database owner role, before the API starts (the
// compose.prod.yml `migrate` service, decision 12). Dev and tests migrate on API start instead.
// Usage: MIGRATION_DATABASE_URL=postgres://family_owner:…@postgres:5432/family node dist/db/migrate-cli.js
import { z } from 'zod';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

const parsed = z
  .object({ MIGRATION_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) })
  .safeParse(process.env);
if (!parsed.success) {
  console.error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}
const { db, sql } = createDb(parsed.data.MIGRATION_DATABASE_URL);
try {
  await runMigrations(db);
  console.log('Migrations are up to date.');
} finally {
  await sql.end({ timeout: 5 });
}
