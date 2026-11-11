import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { accounts, resetLinks, sessions, twoFactorMoves, twoFactors, users } from './schema.js';

const deps = createDeps(loadConfig());
const { db } = deps;

const createdUserIds: string[] = [];

afterEach(async () => {
  const ids = createdUserIds.splice(0);
  if (ids.length === 0) return;
  await db.delete(users).where(inArray(users.id, ids));
});

afterAll(async () => {
  await deps.close();
});

async function newUser(email = `auth-schema-${crypto.randomUUID()}@example.test`) {
  const [user] = await db.insert(users).values({ name: 'Test User', email }).returning();
  createdUserIds.push(user!.id);
  return user!;
}

const inOneDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

describe('auth tables', () => {
  it('generates uuid ids and defaults in the database', async () => {
    const user = await newUser();
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.emailVerified).toBe(false);
    expect(user.twoFactorEnabled).toBe(false);
  });

  it('keeps emails unique', async () => {
    const user = await newUser();
    await expect(db.insert(users).values({ name: 'Dup', email: user.email })).rejects.toMatchObject(
      { cause: { constraint_name: 'users_email_unique' } },
    );
  });

  it('cascades a user delete to sessions, accounts, two_factors and reset_links', async () => {
    const user = await newUser();
    await db
      .insert(sessions)
      .values({ userId: user.id, token: crypto.randomUUID(), expiresAt: inOneDay() });
    await db
      .insert(accounts)
      .values({ userId: user.id, accountId: user.id, providerId: 'credential' });
    await db.insert(twoFactors).values({ userId: user.id, secret: 'enc', backupCodes: 'enc' });
    await db
      .insert(resetLinks)
      .values({ userId: user.id, tokenHash: crypto.randomUUID(), expiresAt: inOneDay() });

    await db.delete(users).where(eq(users.id, user.id));

    expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
    expect(await db.select().from(accounts).where(eq(accounts.userId, user.id))).toHaveLength(0);
    expect(await db.select().from(twoFactors).where(eq(twoFactors.userId, user.id))).toHaveLength(
      0,
    );
    expect(await db.select().from(resetLinks).where(eq(resetLinks.userId, user.id))).toHaveLength(
      0,
    );
  });

  it('nulls reset_links.created_by_user_id when the creator is deleted', async () => {
    const owner = await newUser();
    const member = await newUser();
    const [link] = await db
      .insert(resetLinks)
      .values({
        userId: member.id,
        createdByUserId: owner.id,
        tokenHash: crypto.randomUUID(),
        expiresAt: inOneDay(),
      })
      .returning();

    await db.delete(users).where(eq(users.id, owner.id));

    const [after] = await db.select().from(resetLinks).where(eq(resetLinks.id, link!.id));
    expect(after).toBeDefined();
    expect(after!.createdByUserId).toBeNull();
  });

  it('keeps one pending 2FA move per user, gone with its user or its session', async () => {
    const user = await newUser();
    const [session] = await db
      .insert(sessions)
      .values({ userId: user.id, token: crypto.randomUUID(), expiresAt: inOneDay() })
      .returning();
    const move = { userId: user.id, sessionId: session!.id, secret: 'enc', expiresAt: inOneDay() };
    await db.insert(twoFactorMoves).values(move);
    await expect(db.insert(twoFactorMoves).values(move)).rejects.toMatchObject({
      cause: { constraint_name: 'two_factor_moves_user_id_unique' },
    });

    await db.delete(sessions).where(eq(sessions.id, session!.id));
    expect(
      await db.select().from(twoFactorMoves).where(eq(twoFactorMoves.userId, user.id)),
    ).toHaveLength(0);

    const [again] = await db
      .insert(sessions)
      .values({ userId: user.id, token: crypto.randomUUID(), expiresAt: inOneDay() })
      .returning();
    await db.insert(twoFactorMoves).values({ ...move, sessionId: again!.id });
    await db.delete(users).where(eq(users.id, user.id));
    expect(
      await db.select().from(twoFactorMoves).where(eq(twoFactorMoves.userId, user.id)),
    ).toHaveLength(0);
  });
});
