import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { kinIndex, connectedTo } from '@family-tree/shared';
import { loadLiveGraph } from '../trees/graph.js';
import { parentChild, persons, treeMembers, trees, unions, users } from './schema.js';
import { LARGE_SEED_TREE_NAME, SEED_TREE_NAME, seedLargeFamily, seedSampleFamily } from './seed.js';

const deps = createDeps(loadConfig());
const { db } = deps;

afterAll(async () => {
  await db.delete(trees).where(eq(trees.name, SEED_TREE_NAME));
  await deps.close();
});

describe('seedSampleFamily', () => {
  it('creates the sample family and is idempotent', async () => {
    await seedSampleFamily(db);
    const { treeId, rootPersonId } = await seedSampleFamily(db);

    expect(await db.select().from(trees).where(eq(trees.name, SEED_TREE_NAME))).toHaveLength(1);
    expect(await db.select().from(persons).where(eq(persons.treeId, treeId))).toHaveLength(10);
    expect(await db.select().from(unions).where(eq(unions.treeId, treeId))).toHaveLength(4);
    expect(await db.select().from(parentChild).where(eq(parentChild.treeId, treeId))).toHaveLength(
      6,
    );

    const [tree] = await db.select().from(trees).where(eq(trees.id, treeId));
    const [root] = await db.select().from(persons).where(eq(persons.id, rootPersonId));
    expect(tree!.rootPersonId).toBe(rootPersonId);
    expect(root!.givenName).toBe('Leo');
  });

  it('models half-siblings through two unions that share David', async () => {
    const { treeId } = await seedSampleFamily(db);
    const named = async (givenName: string) =>
      (
        await db
          .select()
          .from(persons)
          .where(and(eq(persons.treeId, treeId), eq(persons.givenName, givenName)))
      )[0]!;
    const [david, emma, leo] = [await named('David'), await named('Emma'), await named('Leo')];

    const davidsUnions = await db
      .select()
      .from(unions)
      .where(or(eq(unions.partnerAId, david.id), eq(unions.partnerBId, david.id)));
    expect(davidsUnions.map((u) => u.status).sort()).toEqual(['divorced', 'married']);

    const links = await db
      .select()
      .from(parentChild)
      .where(inArray(parentChild.childId, [emma.id, leo.id]));
    expect(new Set(links.map((l) => l.unionId)).size).toBe(2);
    expect(links.every((l) => davidsUnions.some((u) => u.id === l.unionId))).toBe(true);
  });

  it('includes an adoptive child and a single-partner union', async () => {
    const { treeId } = await seedSampleFamily(db);
    const adoptive = await db
      .select()
      .from(parentChild)
      .where(and(eq(parentChild.treeId, treeId), eq(parentChild.kind, 'adoptive')));
    expect(adoptive).toHaveLength(1);
    const single = await db
      .select()
      .from(unions)
      .where(and(eq(unions.treeId, treeId), isNull(unions.partnerBId)));
    expect(single).toHaveLength(1);
  });

  it('can assign an owner, idempotently', async () => {
    const [user] = await db
      .insert(users)
      .values({ name: 'Seed Owner', email: `seed-${randomUUID()}@example.com` })
      .returning();
    try {
      await seedSampleFamily(db, { ownerUserId: user!.id });
      const { treeId, rootPersonId } = await seedSampleFamily(db, { ownerUserId: user!.id });
      const members = await db.select().from(treeMembers).where(eq(treeMembers.treeId, treeId));
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        userId: user!.id,
        role: 'owner',
        personId: rootPersonId,
      });
      const made = await db.select().from(persons).where(eq(persons.treeId, treeId));
      expect(made.every((p) => p.createdBy === user!.id)).toBe(true);
    } finally {
      await db.delete(trees).where(eq(trees.name, SEED_TREE_NAME));
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });
});

describe('seedLargeFamily', () => {
  const mkUser = async () =>
    (
      await db
        .insert(users)
        .values({ name: 'Large Owner', email: `large-${randomUUID()}@example.com` })
        .returning()
    )[0]!;

  it('creates a connected tree of the requested size and replaces only the owner\'s own', async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const created: string[] = [];
    try {
      const other = await seedLargeFamily(db, { ownerUserId: b.id, people: 100 });
      created.push(other.treeId);
      const first = await seedLargeFamily(db, { ownerUserId: a.id, people: 120 });
      const second = await seedLargeFamily(db, { ownerUserId: a.id, people: 120 });
      created.push(first.treeId, second.treeId);

      const [tree] = await db.select().from(trees).where(eq(trees.id, second.treeId));
      expect(tree!.name).toBe(LARGE_SEED_TREE_NAME);
      expect(tree!.rootPersonId).toBe(second.rootPersonId);
      expect(await db.select().from(persons).where(eq(persons.treeId, second.treeId))).toHaveLength(
        120,
      );
      const graph = await loadLiveGraph(db, second.treeId);
      expect(connectedTo(kinIndex(graph), second.rootPersonId).size).toBe(120);

      expect(await db.select().from(trees).where(eq(trees.id, first.treeId))).toHaveLength(0);
      expect(await db.select().from(trees).where(eq(trees.id, other.treeId))).toHaveLength(1);
    } finally {
      for (const id of created) await db.delete(trees).where(eq(trees.id, id));
      for (const u of [a, b]) await db.delete(users).where(eq(users.id, u.id));
    }
  });
});
