import { emailSchema } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import { ConfigError, type Config, loadConfig } from '../config.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { users } from './schema.js';
import { LARGE_SEED_TREE_NAME, SEED_TREE_NAME, seedLargeFamily, seedSampleFamily } from './seed.js';

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

const USAGE = `Usage: pnpm seed [you@example.com] [--large N]
  --large N  also create "${LARGE_SEED_TREE_NAME}" with N people (100–10000); replaces only
             a tree of that name owned by you (or an ownerless one without an email)`;
const usage = (): never => {
  console.error(USAGE);
  process.exit(1);
};

const args = process.argv.slice(2).filter((a) => a !== '--');
let largeCount: number | undefined;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--large') {
    const n = Number(args[++i]);
    if (!Number.isInteger(n) || n < 100 || n > 10_000) usage();
    largeCount = n;
  } else {
    positional.push(args[i]!);
  }
}
if (positional.length > 1) usage();
const emailArg = positional[0];
let ownerEmail: string | undefined;
if (emailArg !== undefined) {
  const parsed = emailSchema.safeParse(emailArg);
  if (!parsed.success) usage();
  else ownerEmail = parsed.data;
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
    if (largeCount !== undefined) {
      const large = await seedLargeFamily(db, {
        people: largeCount,
        ...(owner ? { ownerUserId: owner.id } : {}),
      });
      console.log(
        `Seeded "${LARGE_SEED_TREE_NAME}" (tree ${large.treeId}) with ${largeCount} people`,
      );
    }
  }
} finally {
  await sql.end();
}
