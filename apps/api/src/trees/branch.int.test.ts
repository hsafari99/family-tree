import { randomUUID } from 'node:crypto';
import { BRANCH_CASES } from '@family-tree/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { parentChild, persons, trees, unions, users } from '../db/schema.js';
import { branchPersonIds } from './branch.js';

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
  const [u] = await db
    .insert(users)
    .values({ name: 'Branch', email: `branch-${randomUUID()}@example.com` })
    .returning();
  userIds.push(u!.id);
  return u!.id;
}

async function newTree() {
  const [t] = await db
    .insert(trees)
    .values({ name: `branch-test-${randomUUID()}` })
    .returning();
  treeIds.push(t!.id);
  return t!.id;
}

/** Inserts a case's graph into a fresh tree; returns key -> uuid maps. */
async function load(graph: (typeof BRANCH_CASES)[number]['graph']) {
  const treeId = await newTree();
  const creators = new Map<string, string>();
  for (const key of new Set(graph.persons.map((p) => p.createdBy).filter((c) => c !== null))) {
    creators.set(key!, await newUser());
  }
  const pid = new Map<string, string>();
  for (const p of graph.persons) {
    const [row] = await db
      .insert(persons)
      .values({
        treeId,
        givenName: p.id,
        createdBy: p.createdBy === null ? null : creators.get(p.createdBy)!,
      })
      .returning();
    pid.set(p.id, row!.id);
  }
  const uid = new Map<string, string>();
  for (const u of graph.unions) {
    const [row] = await db
      .insert(unions)
      .values({
        treeId,
        partnerAId: u.partnerAId === null ? null : pid.get(u.partnerAId)!,
        partnerBId: u.partnerBId === null ? null : pid.get(u.partnerBId)!,
        parentsUnknown: u.parentsUnknown ?? false,
      })
      .returning();
    uid.set(u.id, row!.id);
  }
  const links = new Map<string, string>();
  for (const pc of graph.parentChild) {
    const [row] = await db
      .insert(parentChild)
      .values({ treeId, unionId: uid.get(pc.unionId)!, childId: pid.get(pc.childId)! })
      .returning();
    links.set(`${pc.unionId}>${pc.childId}`, row!.id);
  }
  const keyOf = new Map([...pid].map(([k, v]) => [v, k]));
  const toKeys = (ids: Set<string>) => [...ids].map((i) => keyOf.get(i) ?? i).sort();
  return { treeId, pid, creators, links, toKeys };
}

const hale = BRANCH_CASES[0]!.graph;

describe('branchPersonIds matches branchOf', () => {
  for (const c of BRANCH_CASES) {
    it(c.name, async () => {
      const t = await load(c.graph);
      const anchor = t.pid.get(c.anchor) ?? randomUUID();
      const steward = c.steward === null ? null : t.creators.get(c.steward)!;
      const got = await branchPersonIds(db, t.treeId, anchor, steward);
      expect(t.toKeys(got)).toEqual([...c.expected].sort());
    });
  }
});

describe('branchPersonIds: what only SQL can check', () => {
  it('ignores a deleted person', async () => {
    const t = await load(hale);
    await db
      .update(persons)
      .set({ deletedAt: new Date() })
      .where(eq(persons.id, t.pid.get('zoe')!));
    const got = await branchPersonIds(db, t.treeId, t.pid.get('robert')!, null);
    expect(t.toKeys(got)).not.toContain('zoe');
    expect(t.toKeys(got)).toContain('leo');
  });

  it('ignores a deleted parent link', async () => {
    const t = await load(hale);
    await db
      .update(parentChild)
      .set({ deletedAt: new Date() })
      .where(eq(parentChild.id, t.links.get('u_gh>laura')!));
    const keys = t.toKeys(await branchPersonIds(db, t.treeId, t.pid.get('robert')!, null));
    expect(keys).toContain('laura');
    expect(keys).not.toContain('george');
    expect(keys).not.toContain('helen');
  });

  it('a soft-deleted union excludes the partner side', async () => {
    const t = await load(hale);
    const [u] = await db
      .select({ id: unions.id })
      .from(unions)
      .where(eq(unions.partnerBId, t.pid.get('anna')!));
    await db.update(unions).set({ deletedAt: new Date() }).where(eq(unions.id, u!.id));
    const keys = t.toKeys(await branchPersonIds(db, t.treeId, t.pid.get('robert')!, null));
    expect(keys).toContain('david');
    expect(keys).not.toContain('anna');
    expect(keys).not.toContain('emma');
  });

  it('a soft-deleted partner is not pulled in by rule 4', async () => {
    const t = await load(hale);
    await db
      .update(persons)
      .set({ deletedAt: new Date() })
      .where(eq(persons.id, t.pid.get('anna')!));
    const keys = t.toKeys(await branchPersonIds(db, t.treeId, t.pid.get('robert')!, null));
    expect(keys).not.toContain('anna');
    expect(keys).toContain('emma');
  });

  it('does not walk through a soft-deleted parent to their ancestors', async () => {
    const t = await load(hale);
    await db
      .update(persons)
      .set({ deletedAt: new Date() })
      .where(eq(persons.id, t.pid.get('david')!));
    const keys = t.toKeys(await branchPersonIds(db, t.treeId, t.pid.get('leo')!, null));
    expect(keys).not.toContain('robert');
    expect(keys).not.toContain('margaret');
    expect(keys).not.toContain('susan');
    expect(keys).toContain('laura');
    expect(keys).toContain('george');
  });

  it('never includes people from another tree', async () => {
    const t = await load(hale);
    const other = await newTree();
    const [stranger] = await db
      .insert(persons)
      .values({ treeId: other, givenName: 'Stranger', createdBy: t.creators.get('u1')! })
      .returning();
    const got = await branchPersonIds(db, t.treeId, t.pid.get('anna')!, t.creators.get('u1')!);
    expect(got.has(stranger!.id)).toBe(false);
    expect(got.has(t.pid.get('kim')!)).toBe(true);
  });
});
