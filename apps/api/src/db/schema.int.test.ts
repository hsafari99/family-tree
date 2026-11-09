import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { persons, trees, unions } from './schema.js';

const deps = createDeps(loadConfig());
const { db } = deps;

afterAll(async () => {
  await deps.close();
});

async function newTree() {
  const [tree] = await db
    .insert(trees)
    .values({ name: `schema-test-${crypto.randomUUID()}` })
    .returning();
  return tree!;
}

describe('schema constraints', () => {
  it('rejects a union with no partners', async () => {
    const tree = await newTree();
    // Drizzle 0.45 wraps driver errors in DrizzleQueryError; the constraint name is on `cause`.
    await expect(db.insert(unions).values({ treeId: tree.id })).rejects.toMatchObject({
      cause: { constraint_name: 'unions_has_partner' },
    });
    await db.delete(trees).where(eq(trees.id, tree.id));
  });

  it('allows a union with a single known partner', async () => {
    const tree = await newTree();
    const [mum] = await db
      .insert(persons)
      .values({ treeId: tree.id, givenName: 'Mum' })
      .returning();
    const [u] = await db
      .insert(unions)
      .values({ treeId: tree.id, partnerAId: mum!.id })
      .returning();
    expect(u!.status).toBe('married');
    await db.delete(trees).where(eq(trees.id, tree.id));
  });

  it('cascades a hard tree delete to its people and unions', async () => {
    const tree = await newTree();
    const [p] = await db.insert(persons).values({ treeId: tree.id, givenName: 'Solo' }).returning();
    await db.insert(unions).values({ treeId: tree.id, partnerAId: p!.id });
    await db.delete(trees).where(eq(trees.id, tree.id));
    expect(await db.select().from(persons).where(eq(persons.treeId, tree.id))).toHaveLength(0);
    expect(await db.select().from(unions).where(eq(unions.treeId, tree.id))).toHaveLength(0);
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
    await db.delete(trees).where(eq(trees.id, tree.id));
  });
});
