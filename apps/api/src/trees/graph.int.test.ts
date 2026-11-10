import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { parentChild, persons, trees, unions } from '../db/schema.js';
import { loadLiveGraph, lockTreeGraph } from './graph.js';

const deps = createDeps(loadConfig());
const { db } = deps;
const treeIds: string[] = [];

afterEach(async () => {
  const t = treeIds.splice(0);
  if (t.length > 0) await db.delete(trees).where(inArray(trees.id, t));
});
afterAll(async () => {
  await deps.close();
});

async function newTree() {
  const [t] = await db
    .insert(trees)
    .values({ name: `graph-test-${crypto.randomUUID()}` })
    .returning();
  treeIds.push(t!.id);
  return t!;
}

async function family(treeId: string) {
  const [a, b, c, d] = await db
    .insert(persons)
    .values(['A', 'B', 'C', 'D'].map((givenName) => ({ treeId, givenName })))
    .returning();
  const [u1, u2, u3] = await db
    .insert(unions)
    .values([
      { treeId, partnerAId: a!.id, partnerBId: b!.id },
      { treeId, partnerAId: d!.id, partnerBId: null },
      { treeId, partnerAId: a!.id, partnerBId: null },
    ])
    .returning();
  const [l1, l3] = await db
    .insert(parentChild)
    .values([
      { treeId, unionId: u1!.id, childId: c!.id },
      { treeId, unionId: u3!.id, childId: c!.id },
    ])
    .returning();
  return { a: a!, b: b!, c: c!, d: d!, u1: u1!, u2: u2!, u3: u3!, l1: l1!, l3: l3! };
}

describe('loadLiveGraph', () => {
  it('leaves out dead people, unions without a live partner and dead links', async () => {
    const tree = await newTree();
    const f = await family(tree.id);
    const now = new Date();
    await db.update(persons).set({ deletedAt: now }).where(eq(persons.id, f.d.id));
    await db.update(parentChild).set({ deletedAt: now }).where(eq(parentChild.id, f.l3.id));

    const g = await loadLiveGraph(db, tree.id);
    expect(g.persons.map((p) => p.id).sort()).toEqual([f.a.id, f.b.id, f.c.id].sort());
    expect(g.unions.map((u) => u.id).sort()).toEqual([f.u1.id, f.u3.id].sort());
    expect(g.parentChild.map((l) => l.id)).toEqual([f.l1.id]);
  });

  it('reads a dead partner as an empty slot', async () => {
    const tree = await newTree();
    const f = await family(tree.id);
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, f.b.id));
    const g = await loadLiveGraph(db, tree.id);
    expect(g.unions.find((u) => u.id === f.u1.id)).toEqual({
      id: f.u1.id,
      partnerAId: f.a.id,
      partnerBId: null,
    });
  });

  it('never includes another tree’s rows', async () => {
    const tree = await newTree();
    const other = await newTree();
    await family(tree.id);
    const g = await loadLiveGraph(db, other.id);
    expect(g).toEqual({ persons: [], unions: [], parentChild: [] });
  });
});

describe('lockTreeGraph', () => {
  it('makes a second transaction on the same tree wait', async () => {
    const tree = await newTree();
    const events: string[] = [];
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const tx1Locked = new Promise<void>((r) => (locked = r));

    const tx1 = db.transaction(async (tx) => {
      await lockTreeGraph(tx, tree.id);
      locked();
      await hold;
      events.push('tx1 commit');
    });
    await tx1Locked;
    const tx2 = db.transaction(async (tx) => {
      await lockTreeGraph(tx, tree.id);
      events.push('tx2 locked');
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(events).toEqual([]);
    release();
    await Promise.all([tx1, tx2]);
    expect(events).toEqual(['tx1 commit', 'tx2 locked']);
  });
});
