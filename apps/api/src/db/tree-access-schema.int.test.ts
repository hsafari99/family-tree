import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { branchStewards, invites, persons, treeMembers, trees, users } from './schema.js';

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
    .values({ name: 'Test', email: `access-${key}@example.com` })
    .returning();
  userIds.push(u!.id);
  return u!;
}

async function newTree() {
  const [t] = await db
    .insert(trees)
    .values({ name: `access-test-${crypto.randomUUID()}` })
    .returning();
  treeIds.push(t!.id);
  return t!;
}

async function newPerson(treeId: string, createdBy?: string) {
  const [p] = await db
    .insert(persons)
    .values({ treeId, givenName: 'P', createdBy: createdBy ?? null })
    .returning();
  return p!;
}

const member = (
  treeId: string,
  userId: string,
  role: 'owner' | 'editor' | 'viewer',
  personId?: string,
) => db.insert(treeMembers).values({ treeId, userId, role, personId: personId ?? null });

const grant = async (
  treeId: string,
  userId: string,
  anchorPersonId: string,
  parentGrantId?: string,
) => {
  const [g] = await db
    .insert(branchStewards)
    .values({ treeId, userId, anchorPersonId, parentGrantId: parentGrantId ?? null })
    .returning();
  return g!;
};

describe('tree access schema', () => {
  it('allows one owner per tree but many editors', async () => {
    const tree = await newTree();
    const [a, b, c, d] = [await newUser(), await newUser(), await newUser(), await newUser()];
    await member(tree.id, a.id, 'owner');
    await expect(member(tree.id, b.id, 'owner')).rejects.toThrow();
    await member(tree.id, b.id, 'editor');
    await member(tree.id, c.id, 'editor');
    await member(tree.id, d.id, 'viewer');
  });

  it('rejects two members claiming the same person card', async () => {
    const tree = await newTree();
    const [a, b] = [await newUser(), await newUser()];
    const p = await newPerson(tree.id);
    await member(tree.id, a.id, 'owner', p.id);
    await expect(member(tree.id, b.id, 'viewer', p.id)).rejects.toThrow();
  });

  it('rejects a person card from another tree', async () => {
    const tree = await newTree();
    const other = await newTree();
    const u = await newUser();
    const p = await newPerson(other.id);
    await expect(member(tree.id, u.id, 'owner', p.id)).rejects.toThrow();
  });

  it('deletes a member’s grants with the member', async () => {
    const tree = await newTree();
    const [o, s] = [await newUser(), await newUser()];
    const p = await newPerson(tree.id);
    await member(tree.id, o.id, 'owner');
    await member(tree.id, s.id, 'viewer');
    await grant(tree.id, s.id, p.id);
    await db.delete(treeMembers).where(eq(treeMembers.userId, s.id));
    expect(
      await db.select().from(branchStewards).where(eq(branchStewards.treeId, tree.id)),
    ).toEqual([]);
  });

  it('deletes derived grants recursively', async () => {
    const tree = await newTree();
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    const p = await newPerson(tree.id);
    for (const u of [a, b, c]) await member(tree.id, u.id, 'viewer');
    const g1 = await grant(tree.id, a.id, p.id);
    const g2 = await grant(tree.id, b.id, p.id, g1.id);
    await grant(tree.id, c.id, p.id, g2.id);
    await db.delete(branchStewards).where(eq(branchStewards.id, g1.id));
    expect(
      await db.select().from(branchStewards).where(eq(branchStewards.treeId, tree.id)),
    ).toEqual([]);
  });

  it('rejects an owner invite', async () => {
    const tree = await newTree();
    const u = await newUser();
    await expect(
      db.insert(invites).values({
        tokenHash: crypto.randomUUID(),
        treeId: tree.id,
        role: 'owner',
        createdByUserId: u.id,
        expiresAt: new Date(Date.now() + 1000),
      }),
    ).rejects.toThrow();
  });

  it('removes members, grants and invites with the tree', async () => {
    const tree = await newTree();
    const [o, s] = [await newUser(), await newUser()];
    const p = await newPerson(tree.id);
    await member(tree.id, o.id, 'owner', p.id);
    await member(tree.id, s.id, 'viewer');
    await grant(tree.id, s.id, p.id);
    await db.insert(invites).values({
      tokenHash: crypto.randomUUID(),
      treeId: tree.id,
      role: 'viewer',
      stewardAnchorPersonId: p.id,
      targetPersonId: p.id,
      createdByUserId: o.id,
      expiresAt: new Date(Date.now() + 1000),
    });
    await db.delete(trees).where(eq(trees.id, tree.id));
    for (const table of [treeMembers, branchStewards, invites]) {
      expect(await db.select().from(table).where(eq(table.treeId, tree.id))).toEqual([]);
    }
  });

  it('keeps a person but clears created_by when the user is deleted', async () => {
    const tree = await newTree();
    const u = await newUser();
    const p = await newPerson(tree.id, u.id);
    await db.delete(users).where(eq(users.id, u.id));
    const [row] = await db.select().from(persons).where(eq(persons.id, p.id));
    expect(row?.createdBy).toBeNull();
  });
});
