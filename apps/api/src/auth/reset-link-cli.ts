// Dev-only: prints a one-time password-reset link for an email. The owner UI that issues
// these links arrives in phase 3. Usage: pnpm reset-link you@example.com
import { emailSchema } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import { ConfigError, type Config, loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { createResetLink } from './reset-links.js';

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
  console.error('Refusing to issue reset links from the dev CLI in production.');
  process.exit(1);
}

const parsed = emailSchema.safeParse(process.argv[2] ?? '');
if (!parsed.success) {
  console.error('Usage: pnpm reset-link <email>');
  process.exit(1);
}
const email = parsed.data;

const { db, sql } = createDb(config.DATABASE_URL);
try {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) {
    console.error(`No user with email ${email}.`);
    process.exitCode = 1;
  } else {
    const { token, expiresAt } = await createResetLink(db, {
      userId: user.id,
      createdByUserId: null,
      ttlHours: 24,
    });
    console.log(`${config.WEB_ORIGIN}/reset/${token}`);
    console.log(`Valid once, until ${expiresAt.toISOString()}.`);
  }
} finally {
  await sql.end();
}
