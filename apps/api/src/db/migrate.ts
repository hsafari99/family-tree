import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Db } from './client.js';

// src/db/migrate.ts and dist/db/migrate.js both resolve to apps/api/drizzle
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Arbitrary constant ("migr" in ASCII): serialises migrators across processes. */
export const MIGRATION_LOCK_KEY = 0x6d696772;

/**
 * Two processes starting together (a dev API and the test setup, MIGRATE_ON_START on two replicas)
 * would race on the migrations table. A session-level advisory lock, held on a connection of its
 * own while the migrations run on the pool, makes the second one wait and then find nothing to do.
 */
export async function runMigrations(db: Db): Promise<void> {
  const lock = await db.$client.reserve();
  try {
    await lock`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    await migrate(db, { migrationsFolder });
  } finally {
    try {
      await lock`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    } finally {
      lock.release();
    }
  }
}
