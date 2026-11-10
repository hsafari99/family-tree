import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { call } from '../../test/auth-helpers.js';
import {
  addGrant,
  addMember,
  addPerson,
  auditRows,
  ownerWithTree,
  softDeleteBatch,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import {
  auditLog,
  branchStewards,
  deletionBatches,
  invites,
  persons,
  treeMembers,
  trees,
} from '../db/schema.js';
import { createDeps } from '../deps.js';
import { purgeDeletedTrees, startPurgeJob } from './purge.js';

const config = loadConfig();
const deps = createDeps(config);
const { db } = deps;
const auth = createAuth({ config, db, rateLimitEnabled: false });
const app = buildApp({ config, checks: deps.checks, auth, db });

afterAll(async () => {
  await app.close();
  await deps.close();
});

const ago = (treeId: string, days: number) =>
  db.execute(
    sql`update trees set deleted_at = now() - ${`${days} days`}::interval where id = ${treeId}`,
  );

async function fullTree() {
  const { owner, treeId } = await ownerWithTree(app);
  const p = await addPerson(db, treeId, 'Anchor');
  const m = await userWith2fa(app, 'Mem');
  await addMember(db, treeId, m.userId, 'viewer', owner.userId);
  await db.update(treeMembers).set({ personId: p.id }).where(eq(treeMembers.userId, m.userId));
  await db.insert(invites).values({
    treeId,
    role: 'editor',
    stewardAnchorPersonId: p.id,
    tokenHash: crypto.randomUUID(),
    createdByUserId: owner.userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await addGrant(db, treeId, m.userId, p.id, owner.userId);
  const gone = await addPerson(db, treeId, 'Gone');
  await softDeleteBatch(db, treeId, owner.userId, [gone.id]);
  await call(app, 'PATCH', `/api/v1/trees/${treeId}/persons/${p.id}`, {
    jar: owner.jar,
    body: { version: 1, surname: 'Z' },
  });
  return { owner, treeId };
}

describe('purgeDeletedTrees', () => {
  it('purges due trees with everything in them, keeps the rest', async () => {
    const a = await fullTree();
    await ago(a.treeId, 31);
    const b = await fullTree();
    await ago(b.treeId, 29);
    const c = await ownerWithTree(app);
    const d = await ownerWithTree(app);
    await db.delete(treeMembers).where(eq(treeMembers.treeId, d.treeId));
    await ago(d.treeId, 31);

    const { ids: purged } = await purgeDeletedTrees(db);
    expect(purged).toContain(a.treeId);
    expect(purged).toContain(d.treeId);
    expect(purged).not.toContain(b.treeId);
    expect(purged).not.toContain(c.treeId);
    expect(await db.select().from(trees).where(eq(trees.id, a.treeId))).toHaveLength(0);
    expect(await db.select().from(persons).where(eq(persons.treeId, a.treeId))).toHaveLength(0);
    expect(
      await db.select().from(treeMembers).where(eq(treeMembers.treeId, a.treeId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(branchStewards).where(eq(branchStewards.treeId, a.treeId)),
    ).toHaveLength(0);
    expect(await db.select().from(invites).where(eq(invites.treeId, a.treeId))).toHaveLength(0);
    expect(
      await db.select().from(deletionBatches).where(eq(deletionBatches.treeId, a.treeId)),
    ).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.treeId, a.treeId))).toHaveLength(0);
    expect(await db.select().from(trees).where(eq(trees.id, d.treeId))).toHaveLength(0);
    expect(await db.select().from(trees).where(eq(trees.id, b.treeId))).toHaveLength(1);
    expect(await db.select().from(trees).where(eq(trees.id, c.treeId))).toHaveLength(1);
    expect((await auditRows(db, b.treeId)).length).toBeGreaterThan(0);
  });

  it('copes with concurrent calls', async () => {
    const a = await fullTree();
    const b = await fullTree();
    await ago(a.treeId, 31);
    await ago(b.treeId, 31);
    const [x, y] = await Promise.all([purgeDeletedTrees(db), purgeDeletedTrees(db)]);
    const all = [...x.ids, ...y.ids];
    expect(all).toContain(a.treeId);
    expect(all).toContain(b.treeId);
  });
});

describe('startPurgeJob', () => {
  it('purges on start and stops', async () => {
    const a = await fullTree();
    await ago(a.treeId, 31);
    const log = { info: vi.fn(), error: vi.fn() };
    const stop = startPurgeJob(db, log, 60_000);
    await vi.waitFor(async () => {
      expect(await db.select().from(trees).where(eq(trees.id, a.treeId))).toHaveLength(0);
      expect(log.info).toHaveBeenCalledWith({ count: expect.any(Number) }, expect.any(String));
    });
    await stop();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('purge batching and locking', () => {
  it('purges more trees than one batch holds', async () => {
    const rows = await db
      .insert(trees)
      .values(
        Array.from({ length: 120 }, (_, i) => ({
          name: `old ${i}`,
          deletedAt: new Date(Date.now() - 40 * 86_400_000),
        })),
      )
      .returning({ id: trees.id });
    const { ids, busy } = await purgeDeletedTrees(db);
    expect(busy).toBe(false);
    for (const r of rows) expect(ids).toContain(r.id);
  });

  it('reports busy while another purge holds the lock', async () => {
    let result: Awaited<ReturnType<typeof purgeDeletedTrees>> | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('purge-trees', 0))`);
      result = await purgeDeletedTrees(db);
    });
    expect(result).toEqual({ ids: [], busy: true });
  });

  it('measures age with the database clock', async () => {
    const [t] = await db
      .insert(trees)
      .values({ name: 'edge', deletedAt: sql`now() - interval '29 days 23 hours'` })
      .returning({ id: trees.id });
    const { ids } = await purgeDeletedTrees(db);
    expect(ids).not.toContain(t!.id);
  });

  it('awaits an in-flight run when stopped', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const stop = startPurgeJob(db, log, 60_000);
    await stop();
    expect(log.error).not.toHaveBeenCalled();
  });
});
