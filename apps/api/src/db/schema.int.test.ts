import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { parentChild, persons, trees, unions } from './schema.js';

const deps = createDeps(loadConfig());
const { db } = deps;

// Track every tree a test creates so cleanup runs even when an assertion fails.
const createdTreeIds: string[] = [];

afterEach(async () => {
  const ids = createdTreeIds.splice(0);
  if (ids.length === 0) return;
  await db.delete(trees).where(inArray(trees.id, ids));
});

afterAll(async () => {
  await deps.close();
});

async function newTree() {
  const [tree] = await db
    .insert(trees)
    .values({ name: `schema-test-${crypto.randomUUID()}` })
    .returning();
  createdTreeIds.push(tree!.id);
  return tree!;
}

async function newPerson(treeId: string, givenName = 'Person') {
  const [p] = await db.insert(persons).values({ treeId, givenName }).returning();
  return p!;
}

// Drizzle 0.45 wraps driver errors in DrizzleQueryError; the constraint name is on `cause`.
const violates = (constraint: string) => ({ cause: { constraint_name: constraint } });

describe('schema constraints', () => {
  it('rejects a union with no partners', async () => {
    const tree = await newTree();
    await expect(db.insert(unions).values({ treeId: tree.id })).rejects.toMatchObject(
      violates('unions_has_partner'),
    );
  });

  it('allows a union with a single known partner', async () => {
    const tree = await newTree();
    const mum = await newPerson(tree.id, 'Mum');
    const [u] = await db.insert(unions).values({ treeId: tree.id, partnerAId: mum.id }).returning();
    expect(u!.status).toBe('married');
  });

  it('rejects a person partnered with themselves', async () => {
    const tree = await newTree();
    const p = await newPerson(tree.id);
    await expect(
      db.insert(unions).values({ treeId: tree.id, partnerAId: p.id, partnerBId: p.id }),
    ).rejects.toMatchObject(violates('unions_distinct_partners'));
  });

  it('cascades a hard tree delete to its people and unions', async () => {
    const tree = await newTree();
    const p = await newPerson(tree.id, 'Solo');
    await db.insert(unions).values({ treeId: tree.id, partnerAId: p.id });
    await db.delete(trees).where(eq(trees.id, tree.id));
    expect(await db.select().from(persons).where(eq(persons.treeId, tree.id))).toHaveLength(0);
    expect(await db.select().from(unions).where(eq(unions.treeId, tree.id))).toHaveLength(0);
  });

  it('cascades a hard delete of a tree whose root person is set', async () => {
    const tree = await newTree();
    const root = await newPerson(tree.id, 'Root');
    await db.update(trees).set({ rootPersonId: root.id }).where(eq(trees.id, tree.id));
    await db.delete(trees).where(eq(trees.id, tree.id));
    expect(await db.select().from(persons).where(eq(persons.treeId, tree.id))).toHaveLength(0);
  });

  it('stores fuzzy dates as JSON', async () => {
    const tree = await newTree();
    const [p] = await db
      .insert(persons)
      .values({
        treeId: tree.id,
        givenName: 'Old',
        birthDate: { qualifier: 'about', date1: '1920' },
        birthSortYear: 1920,
      })
      .returning();
    expect(p!.birthDate).toEqual({ qualifier: 'about', date1: '1920' });
  });
});

describe('parent_child uniqueness', () => {
  it('allows re-linking a soft-deleted link but not a second live duplicate', async () => {
    const tree = await newTree();
    const mum = await newPerson(tree.id, 'Mum');
    const kid = await newPerson(tree.id, 'Kid');
    const [u] = await db.insert(unions).values({ treeId: tree.id, partnerAId: mum.id }).returning();
    const link = { treeId: tree.id, unionId: u!.id, childId: kid.id };

    const [first] = await db.insert(parentChild).values(link).returning();
    await db
      .update(parentChild)
      .set({ deletedAt: new Date() })
      .where(eq(parentChild.id, first!.id));
    await db.insert(parentChild).values(link);

    await expect(db.insert(parentChild).values(link)).rejects.toMatchObject(
      violates('parent_child_union_child_uq'),
    );
  });
});

describe('tree isolation', () => {
  it('rejects a union whose partner belongs to another tree', async () => {
    const tree = await newTree();
    const other = await newTree();
    const local = await newPerson(tree.id, 'Local');
    const foreign = await newPerson(other.id, 'Foreign');
    await expect(
      db.insert(unions).values({ treeId: tree.id, partnerAId: local.id, partnerBId: foreign.id }),
    ).rejects.toMatchObject(violates('unions_partner_b_fk'));
    await expect(
      db.insert(unions).values({ treeId: tree.id, partnerAId: foreign.id }),
    ).rejects.toMatchObject(violates('unions_partner_a_fk'));
  });

  it('rejects a parent_child link to a child from another tree', async () => {
    const tree = await newTree();
    const other = await newTree();
    const mum = await newPerson(tree.id, 'Mum');
    const foreignKid = await newPerson(other.id, 'Foreign kid');
    const [u] = await db.insert(unions).values({ treeId: tree.id, partnerAId: mum.id }).returning();
    await expect(
      db.insert(parentChild).values({ treeId: tree.id, unionId: u!.id, childId: foreignKid.id }),
    ).rejects.toMatchObject(violates('parent_child_child_fk'));
  });

  it("rejects setting a tree's root to another tree's person", async () => {
    const tree = await newTree();
    const other = await newTree();
    const foreign = await newPerson(other.id, 'Foreign');
    await expect(
      db.update(trees).set({ rootPersonId: foreign.id }).where(eq(trees.id, tree.id)),
    ).rejects.toMatchObject(violates('trees_root_person_fk'));
  });

  it('rejects deleting the root person directly', async () => {
    const tree = await newTree();
    const root = await newPerson(tree.id, 'Root');
    await db.update(trees).set({ rootPersonId: root.id }).where(eq(trees.id, tree.id));
    await expect(db.delete(persons).where(eq(persons.id, root.id))).rejects.toMatchObject(
      violates('trees_root_person_fk'),
    );
  });
});
