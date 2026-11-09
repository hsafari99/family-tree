import { emailSchema } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import { ConfigError, type Config, loadConfig } from '../config.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { users } from './schema.js';
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

const emailArg = process.argv[2];
let ownerEmail: string | undefined;
if (emailArg !== undefined) {
  const parsed = emailSchema.safeParse(emailArg);
  if (!parsed.success) {
    console.error('Usage: pnpm seed [you@example.com]');
    process.exit(1);
  }
  ownerEmail = parsed.data;
}

const { db, sql } = createDb(config.DATABASE_URL);
try {
  await runMigrations(db);
  let owner: { id: string; twoFactorEnabled: boolean } | undefined;
  if (ownerEmail !== undefined) {
    [owner] = await db
      .select({ id: users.id, twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.email, ownerEmail));
    if (!owner) {
      console.error(`No user with email ${ownerEmail}`);
      process.exitCode = 1;
    } else if (!owner.twoFactorEnabled) {
      console.warn('Note: owners must have two-step verification; turn it on in Account settings.');
    }
  }
  if (ownerEmail === undefined || owner) {
    const { treeId } = await seedSampleFamily(db, owner ? { ownerUserId: owner.id } : {});
    console.log(
      `Seeded "${SEED_TREE_NAME}" (tree ${treeId})` +
        (ownerEmail ? `, owned by ${ownerEmail}` : ''),
    );
  }
} finally {
  await sql.end();
}
