import { ACTIVITY_LIMIT, homeSummarySchema } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, type CookieJar, signUp } from '../../test/auth-helpers.js';
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
import { auditLog, trees } from '../db/schema.js';
import { createDeps } from '../deps.js';

const config = loadConfig();
const deps = createDeps(config);
const { db } = deps;
const auth = createAuth({ config, db, rateLimitEnabled: false });

let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  app = buildApp({ config, checks: deps.checks, auth, db });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await deps.close();
});

async function home(jar: CookieJar, query = '') {
  const res = await call(app, 'GET', `/api/v1/home${query}`, { jar });
  expect(res.statusCode, res.body).toBe(200);
  return homeSummarySchema.parse(res.json());
}

/** An audit row at a chosen time, so ordering is deterministic. */
async function addAudit(
  treeId: string,
  userId: string | null,
  action: (typeof auditLog.$inferInsert)['action'],
  personIds: string[],
  at: Date,
) {
  const [row] = await db
    .insert(auditLog)
    .values({
      treeId,
      userId,
      action,
      entityType: 'person',
      entityId: personIds[0] ?? null,
      personIds,
      createdAt: at,
    })
    .returning();
  return row!;
}

describe('GET /api/v1/home', () => {
  it('needs a session', async () => {
    expect((await call(app, 'GET', '/api/v1/home')).statusCode).toBe(401);
  });

  it('is empty for a first-time user', async () => {
    const user = await signUp(app);
    expect(await home(user.jar)).toEqual({ trees: [], deletedTrees: [], activity: [] });
  });

  it("shows each tree's role, live people count, last change and open invites", async () => {
    const { owner, treeId } = await ownerWithTree(app, 'Hale');
    const gone = await addPerson(db, treeId, 'Gone');
    await addPerson(db, treeId, 'Kept');
    await softDeleteBatch(db, treeId, owner.userId, [gone.id]);
    const inv = await call(app, 'POST', `/api/v1/trees/${treeId}/invites`, {
      jar: owner.jar,
      body: { role: 'viewer' },
    });
    expect(inv.statusCode).toBe(201);
    const used = await call(app, 'POST', `/api/v1/trees/${treeId}/invites`, {
      jar: owner.jar,
      body: { role: 'viewer' },
    });
    const joiner = await signUp(app);
    await call(app, 'POST', '/api/v1/invites/accept', {
      jar: joiner.jar,
      body: { token: used.json().token },
    });

    const body = await home(owner.jar);
    expect(body.trees).toHaveLength(1);
    const card = body.trees[0]!;
    expect(card).toMatchObject({ id: treeId, name: 'Hale', role: 'owner', peopleCount: 2 });
    expect(card.openInvites).toBe(1);
    // The last change is the root person's creation (member and invite rows don't count).
    const created = (await auditRows(db, treeId)).find((r) => r.action === 'person.create')!;
    expect(card.updatedAt).toBe(created.createdAt.toISOString());

    // The joined viewer sees the tree as a viewer, with no invite count.
    const theirs = await home(joiner.jar);
    expect(theirs.trees).toEqual([{ ...card, role: 'viewer', openInvites: null }]);
  });

  it('counts only their own open invites for an active steward, none for an editor', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const anchor = await addPerson(db, treeId, 'Anchor');
    const steward = await userWith2fa(app, 'Steward');
    await addMember(db, treeId, steward.userId, 'viewer', owner.userId);
    await addGrant(db, treeId, steward.userId, anchor.id, owner.userId);
    const editor = await signUp(app);
    await addMember(db, treeId, editor.userId, 'editor', owner.userId);
    for (const jar of [owner.jar, steward.jar]) {
      const r = await call(app, 'POST', `/api/v1/trees/${treeId}/invites`, {
        jar,
        body: { role: 'viewer' },
      });
      expect(r.statusCode, r.body).toBe(201);
    }
    expect((await home(owner.jar)).trees[0]!.openInvites).toBe(2);
    expect((await home(steward.jar)).trees[0]!.openInvites).toBe(1);
    expect((await home(editor.jar)).trees[0]!.openInvites).toBeNull();
  });

  it('lists recent changes to live people, newest first, with who made them', async () => {
    const { owner, treeId } = await ownerWithTree(app, 'Hale');
    const leo = await addPerson(db, treeId, 'Leo', { surname: 'Hale' });
    const gone = await addPerson(db, treeId, 'Gone');
    const t = (m: number) => new Date(Date.UTC(2030, 0, 1, 0, m));
    const a = await addAudit(treeId, owner.userId, 'person.update', [leo.id], t(1));
    // Member, steward, invite and tree rows never show (decision 13).
    await addAudit(treeId, owner.userId, 'invite.create', [], t(2));
    await addAudit(treeId, owner.userId, 'tree.rename', [], t(3));
    // A change only to someone now in the Trash doesn't show: History can't reach it either.
    await addAudit(treeId, owner.userId, 'person.update', [gone.id], t(4));
    await softDeleteBatch(db, treeId, owner.userId, [gone.id]);
    // A union of a deleted and a live person names the live one; a former member shows as null.
    const b = await addAudit(treeId, null, 'union.create', [gone.id, leo.id], t(5));

    const body = await home(owner.jar);
    expect(body.activity.slice(0, 2)).toEqual([
      {
        id: b.id,
        treeId,
        treeName: 'Hale',
        action: 'union.create',
        at: t(5).toISOString(),
        by: null,
        person: { id: leo.id, name: 'Leo Hale' },
      },
      {
        id: a.id,
        treeId,
        treeName: 'Hale',
        action: 'person.update',
        at: t(1).toISOString(),
        by: 'Owner',
        person: { id: leo.id, name: 'Leo Hale' },
      },
    ]);
    expect(body.activity.map((e) => e.action)).toEqual([
      'union.create',
      'person.update',
      'person.create',
    ]);
    // The card's last change follows the newest visible change.
    expect(body.trees[0]!.updatedAt).toBe(t(5).toISOString());
  });

  it(`keeps at most ${ACTIVITY_LIMIT} changes across every tree`, async () => {
    const { owner, treeId } = await ownerWithTree(app, 'One');
    const second = await call(app, 'POST', '/api/v1/trees', {
      jar: owner.jar,
      body: { name: 'Two', person: { givenName: 'Tess' } },
    });
    const treeTwo = second.json().tree.id as string;
    const p1 = await addPerson(db, treeId, 'P1');
    const p2 = await addPerson(db, treeTwo, 'P2');
    for (let i = 0; i < ACTIVITY_LIMIT; i++) {
      await addAudit(
        treeId,
        owner.userId,
        'person.update',
        [p1.id],
        new Date(Date.UTC(2031, 0, 1, 0, i)),
      );
    }
    await addAudit(treeTwo, owner.userId, 'person.update', [p2.id], new Date(Date.UTC(2032, 0, 1)));
    const body = await home(owner.jar);
    expect(body.activity).toHaveLength(ACTIVITY_LIMIT);
    expect(body.activity[0]).toMatchObject({ treeId: treeTwo, treeName: 'Two' });
    expect(body.trees.map((x) => x.name)).toEqual(['One', 'Two']);
  });

  it('narrows to one tree with treeId', async () => {
    const { owner } = await ownerWithTree(app, 'One');
    const second = await call(app, 'POST', '/api/v1/trees', {
      jar: owner.jar,
      body: { name: 'Two', person: { givenName: 'Tess' } },
    });
    const treeTwo = second.json().tree.id as string;
    const body = await home(owner.jar, `?treeId=${treeTwo}`);
    expect(body.trees.map((x) => x.id)).toEqual([treeTwo]);
    expect(body.activity.every((e) => e.treeId === treeTwo)).toBe(true);
    expect(body.activity.length).toBeGreaterThan(0);
    expect(body.deletedTrees).toEqual([]);
    const bad = await call(app, 'GET', '/api/v1/home?treeId=nope', { jar: owner.jar });
    expect(bad.statusCode).toBe(400);
  });

  it('is read-only', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const before = await auditRows(db, treeId);
    await home(owner.jar);
    expect(await auditRows(db, treeId)).toEqual(before);
  });

  it('rate limits per user at 60 a minute', async () => {
    const user = await signUp(app);
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await call(app, 'GET', '/api/v1/home', { jar: user.jar })).statusCode;
      if (i < 60) expect(last).toBe(200);
    }
    expect(last).toBe(429);
    // Another user has their own bucket.
    const other = await signUp(app);
    expect((await call(app, 'GET', '/api/v1/home', { jar: other.jar })).statusCode).toBe(200);
  });
});

describe('GET /api/v1/home isolation', () => {
  it("never shows another user's trees or changes", async () => {
    const a = await ownerWithTree(app, 'Secret tree');
    const leo = await addPerson(db, a.treeId, 'Secret', { surname: 'Person' });
    await addAudit(a.treeId, a.owner.userId, 'person.update', [leo.id], new Date());
    const b = await ownerWithTree(app, 'Mine');
    const outsider = await signUp(app);

    const mine = await home(b.owner.jar);
    expect(mine.trees.map((t) => t.id)).toEqual([b.treeId]);
    expect(mine.activity.every((e) => e.treeId === b.treeId)).toBe(true);
    const text = JSON.stringify([mine, await home(outsider.jar)]);
    expect(text).not.toContain(a.treeId);
    expect(text).not.toContain('Secret');

    // Asking for someone else's tree is a 404, the same as a tree that doesn't exist.
    const theirs = await call(app, 'GET', `/api/v1/home?treeId=${a.treeId}`, {
      jar: outsider.jar,
    });
    expect(theirs.statusCode).toBe(404);
    expect(theirs.json().error.code).toBe('NOT_FOUND');
    const none = await call(app, 'GET', `/api/v1/home?treeId=${crypto.randomUUID()}`, {
      jar: outsider.jar,
    });
    expect(none.statusCode).toBe(404);
    expect(none.body).toBe(theirs.body);
  });

  it('drops a removed member and a deleted tree; the owner sees the tree under deleted', async () => {
    const { owner, treeId } = await ownerWithTree(app, 'Hale');
    const viewer = await signUp(app);
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    expect((await home(viewer.jar)).trees).toHaveLength(1);
    const left = await signUp(app);
    await addMember(db, treeId, left.userId, 'editor', owner.userId);
    expect((await home(left.jar)).activity.length).toBeGreaterThan(0);
    const removed = await call(app, 'DELETE', `/api/v1/trees/${treeId}/members/${left.userId}`, {
      jar: owner.jar,
    });
    expect(removed.statusCode).toBe(204);
    expect(await home(left.jar)).toEqual({ trees: [], deletedTrees: [], activity: [] });

    await db.update(trees).set({ deletedAt: new Date() }).where(eq(trees.id, treeId));
    const theirs = await home(viewer.jar);
    expect(theirs).toEqual({ trees: [], deletedTrees: [], activity: [] });
    const mine = await home(owner.jar);
    expect(mine.trees).toEqual([]);
    expect(mine.activity).toEqual([]);
    expect(mine.deletedTrees.map((t) => t.id)).toEqual([treeId]);
    const one = await call(app, 'GET', `/api/v1/home?treeId=${treeId}`, { jar: owner.jar });
    expect(one.statusCode).toBe(404);
  });
});
