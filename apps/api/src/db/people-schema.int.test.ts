import { arrayContains, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import {
  auditLog,
  branchStewards,
  deletionBatches,
  invites,
  parentChild,
  persons,
  treeMembers,
  trees,
  unions,
  users,
} from './schema.js';

const deps = createDeps(loadConfig());
const { db } = deps;

const treeIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  const t = treeIds.splice(0);
  if (t.length > 0) await db.delete(trees).where(inArray(trees.id, t));
  const u = userIds.splice(0);
  if (u.length > 0) await db.delete(users).where(inArray(users.id, u));
});

afterAll(async () => {
  await deps.close();
});

async function newUser() {
  const key = crypto.randomUUID();
  const [u] = await db
    .insert(users)
    .values({ name: 'Test', email: `people-${key}@example.com` })
    .returning();
  userIds.push(u!.id);
  return u!;
}

async function newTree() {
  const [t] = await db
    .insert(trees)
    .values({ name: `people-test-${crypto.randomUUID()}` })
    .returning();
  treeIds.push(t!.id);
  return t!;
}

async function setup() {
  const user = await newUser();
  const tree = await newTree();
  const [a, b] = await db
    .insert(persons)
    .values([
      { treeId: tree.id, givenName: 'A' },
      { treeId: tree.id, givenName: 'B' },
    ])
    .returning();
  const [union] = await db
    .insert(unions)
    .values({ treeId: tree.id, partnerAId: a!.id, partnerBId: b!.id })
    .returning();
  return { user, tree, a: a!, b: b!, union: union! };
}

const newBatch = async (treeId: string, deletedByUserId?: string) => {
  const [batch] = await db
    .insert(deletionBatches)
    .values({ treeId, mode: 'person', deletedByUserId: deletedByUserId ?? null })
    .returning();
  return batch!;
};

describe('people schema', () => {
  it('guards deletion batches with a composite NO ACTION foreign key', async () => {
    const { tree, a } = await setup();
    const batch = await newBatch(tree.id);
    await db.update(persons).set({ deletionBatchId: batch.id }).where(eq(persons.id, a.id));
    await expect(
      db.delete(deletionBatches).where(eq(deletionBatches.id, batch.id)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    await db.update(persons).set({ deletionBatchId: null }).where(eq(persons.id, a.id));
    await db.delete(deletionBatches).where(eq(deletionBatches.id, batch.id));

    const other = await newTree();
    const foreign = await newBatch(other.id);
    await expect(
      db.update(persons).set({ deletionBatchId: foreign.id }).where(eq(persons.id, a.id)),
    ).rejects.toMatchObject({ cause: { constraint_name: 'persons_deletion_batch_fk' } });
  });

  it('defaults slots to an empty list and round-trips them', async () => {
    const { tree, a, union } = await setup();
    const batch = await newBatch(tree.id);
    expect(batch.slots).toEqual([]);
    const slots = [{ unionId: union.id, slot: 'a' as const, personId: a.id }];
    await db.update(deletionBatches).set({ slots }).where(eq(deletionBatches.id, batch.id));
    const [row] = await db.select().from(deletionBatches).where(eq(deletionBatches.id, batch.id));
    expect(row?.slots).toEqual(slots);
  });

  it('finds audit rows by person id', async () => {
    const { tree, a, b } = await setup();
    await db.insert(auditLog).values([
      { treeId: tree.id, action: 'person.update', entityType: 'person', personIds: [a.id] },
      { treeId: tree.id, action: 'person.update', entityType: 'person', personIds: [b.id] },
    ]);
    const rows = await db
      .select()
      .from(auditLog)
      .where(arrayContains(auditLog.personIds, [a.id]));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.personIds).toEqual([a.id]);
  });

  it('clears the user from audit rows and batches when the user is deleted', async () => {
    const { user, tree } = await setup();
    const batch = await newBatch(tree.id, user.id);
    await db.insert(auditLog).values({
      treeId: tree.id,
      userId: user.id,
      action: 'tree.rename',
      entityType: 'tree',
    });
    await db.delete(users).where(eq(users.id, user.id));
    const [b] = await db.select().from(deletionBatches).where(eq(deletionBatches.id, batch.id));
    expect(b?.deletedByUserId).toBeNull();
    const [row] = await db.select().from(auditLog).where(eq(auditLog.treeId, tree.id));
    expect(row?.userId).toBeNull();
  });

  it('deletes a whole tree with batches, tagged rows and audit rows (the purge precondition)', async () => {
    const { user, tree, a, b, union } = await setup();
    await db
      .insert(treeMembers)
      .values({ treeId: tree.id, userId: user.id, role: 'owner', personId: a.id });
    await db.insert(invites).values({
      tokenHash: crypto.randomUUID(),
      treeId: tree.id,
      role: 'viewer',
      stewardAnchorPersonId: a.id,
      targetPersonId: a.id,
      createdByUserId: user.id,
      expiresAt: new Date(Date.now() + 1000),
    });
    await db
      .insert(branchStewards)
      .values({ treeId: tree.id, userId: user.id, anchorPersonId: a.id });
    const batch = await newBatch(tree.id, user.id);
    await db.update(persons).set({ deletionBatchId: batch.id }).where(eq(persons.id, b.id));
    await db.update(unions).set({ deletionBatchId: batch.id }).where(eq(unions.id, union.id));
    const [link] = await db
      .insert(parentChild)
      .values({ treeId: tree.id, unionId: union.id, childId: b.id, deletionBatchId: batch.id })
      .returning();
    await db.insert(auditLog).values({
      treeId: tree.id,
      action: 'person.delete',
      entityType: 'person',
      personIds: [a.id],
    });

    await db.delete(trees).where(eq(trees.id, tree.id));

    for (const table of [
      treeMembers,
      invites,
      branchStewards,
      deletionBatches,
      auditLog,
      persons,
      unions,
      parentChild,
    ]) {
      expect(await db.select().from(table).where(eq(table.treeId, tree.id))).toEqual([]);
    }
    expect(link).toBeDefined();
  });
});
