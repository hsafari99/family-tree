import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { MIGRATION_LOCK_KEY, runMigrations } from './migrate.js';

const { db, sql } = createDb(loadConfig().DATABASE_URL);
afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe('runMigrations', () => {
  it('waits for another migrator to finish (advisory lock), then runs', async () => {
    const other = await sql.reserve();
    await other`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    let settled = false;
    const run = runMigrations(db).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(settled).toBe(false); // blocked behind the other migrator
    await other`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    other.release();
    await run;
    expect(settled).toBe(true);
  });

  it('can run twice in a row and releases the lock each time', async () => {
    await runMigrations(db);
    await runMigrations(db);
    const [row] = await sql`select pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) as got`;
    expect(row?.got).toBe(true);
    await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
  });
});
