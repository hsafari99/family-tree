import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, type CookieJar, signUp } from '../../test/auth-helpers.js';
import { addMember, addPerson, ownerWithTree, userWith2fa } from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { persons, trees } from '../db/schema.js';

const config = { ...loadConfig(), MAX_TREES_PER_USER: 2 };
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

const newTree = (jar: CookieJar, name = 'Tree') =>
  call(app, 'POST', '/api/v1/trees', {
    jar,
    body: { name, person: { givenName: 'Olive', surname: 'Owner' } },
  });

async function editorIn(treeId: string, role: 'editor' | 'viewer' = 'editor') {
  const user = await signUp(app);
  await addMember(db, treeId, user.userId, role);
  return user;
}

const DAY = 86_400_000;

describe('POST /api/v1/trees', () => {
  it('needs a session and 2FA', async () => {
    expect(
      (
        await call(app, 'POST', '/api/v1/trees', {
          body: { name: 'x', person: { givenName: 'A' } },
        })
      ).statusCode,
    ).toBe(401);
    const user = await signUp(app);
    const res = await newTree(user.jar);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('TWO_FACTOR_REQUIRED');
    expect(await db.select().from(trees).where(eq(trees.name, 'Tree'))).toHaveLength(0);
  });

  it('creates a tree with a root person the owner is', async () => {
    const { owner, treeId } = await ownerWithTree(app, 'Hale');
    const list = await call(app, 'GET', '/api/v1/trees', { jar: owner.jar });
    expect(list.json().trees).toEqual([{ id: treeId, name: 'Hale', role: 'owner' }]);
    const detail = (await call(app, 'GET', `/api/v1/trees/${treeId}`, { jar: owner.jar })).json();
    expect(detail.tree.rootPersonId).toBeTruthy();
    expect(detail.me.personId).toBe(detail.tree.rootPersonId);
    expect(detail.me.role).toBe('owner');
    expect(Object.values(detail.capabilities)).toEqual([true, true, true, true]);
    const ps = (
      await call(app, 'GET', `/api/v1/trees/${treeId}/persons`, { jar: owner.jar })
    ).json();
    expect(ps.persons).toHaveLength(1);
    expect(ps.persons[0]).toMatchObject({ givenName: 'Olive', surname: 'Owner', birthYear: null });
    const [row] = await db.select().from(persons).where(eq(persons.treeId, treeId));
    expect(row!.createdBy).toBe(owner.userId);
  });

  it('stores a birth year as an exact fuzzy date', async () => {
    const owner = await userWith2fa(app);
    const res = await call(app, 'POST', '/api/v1/trees', {
      jar: owner.jar,
      body: { name: 'Y', person: { givenName: 'Y', birthYear: 1990 } },
    });
    expect(res.statusCode).toBe(201);
    const [row] = await db.select().from(persons).where(eq(persons.treeId, res.json().tree.id));
    expect(row!.birthDate).toEqual({ qualifier: 'exact', date1: '1990' });
    expect(row!.birthSortYear).toBe(1990);
  });

  it('rejects a blank name', async () => {
    const owner = await userWith2fa(app);
    const res = await call(app, 'POST', '/api/v1/trees', {
      jar: owner.jar,
      body: { name: '  ', person: { givenName: 'A' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    expect(res.json().error.details.name).toBeDefined();
  });

  it('limits owned trees, frees a slot on delete, and holds under concurrency', async () => {
    const owner = await userWith2fa(app);
    const a = await newTree(owner.jar, 'A');
    expect(a.statusCode).toBe(201);
    expect((await newTree(owner.jar, 'B')).statusCode).toBe(201);
    const third = await newTree(owner.jar, 'C');
    expect(third.statusCode).toBe(403);
    expect(third.json().error.code).toBe('QUOTA_EXCEEDED');
    expect(
      (await call(app, 'DELETE', `/api/v1/trees/${a.json().tree.id}`, { jar: owner.jar }))
        .statusCode,
    ).toBe(204);
    expect((await newTree(owner.jar, 'C')).statusCode).toBe(201);
    // Now at 2 again; delete one so exactly one slot is left.
    const list = (await call(app, 'GET', '/api/v1/trees', { jar: owner.jar })).json();
    await call(app, 'DELETE', `/api/v1/trees/${list.trees[0].id}`, { jar: owner.jar });
    const results = await Promise.all([newTree(owner.jar, 'D'), newTree(owner.jar, 'E')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 403]);
  });
});

describe('PATCH /api/v1/trees/:id', () => {
  it('renames, changes root, and validates', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const url = `/api/v1/trees/${treeId}`;
    expect(
      (await call(app, 'PATCH', url, { jar: owner.jar, body: { name: 'Renamed' } })).statusCode,
    ).toBe(204);
    expect((await call(app, 'GET', url, { jar: owner.jar })).json().tree.name).toBe('Renamed');

    const editor = await editorIn(treeId);
    const denied = await call(app, 'PATCH', url, { jar: editor.jar, body: { name: 'Nope' } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('FORBIDDEN');

    const p = await addPerson(db, treeId, 'Pat');
    expect(
      (await call(app, 'PATCH', url, { jar: owner.jar, body: { rootPersonId: p.id } })).statusCode,
    ).toBe(204);

    const other = await ownerWithTree(app, 'Other');
    const foreign = await addPerson(db, other.treeId, 'Fay');
    const bad = await call(app, 'PATCH', url, {
      jar: owner.jar,
      body: { rootPersonId: foreign.id },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION');
    const gone = await addPerson(db, treeId, 'Gone', { deletedAt: new Date() });
    expect(
      (await call(app, 'PATCH', url, { jar: owner.jar, body: { rootPersonId: gone.id } }))
        .statusCode,
    ).toBe(400);
    expect((await call(app, 'PATCH', url, { jar: owner.jar, body: {} })).statusCode).toBe(400);
  });
});

describe('viewer', () => {
  it('has no capabilities', async () => {
    const { treeId } = await ownerWithTree(app);
    const viewer = await editorIn(treeId, 'viewer');
    const d = (await call(app, 'GET', `/api/v1/trees/${treeId}`, { jar: viewer.jar })).json();
    expect(d.me.role).toBe('viewer');
    expect(Object.values(d.capabilities)).toEqual([false, false, false, false]);
  });
});

describe('DELETE and restore', () => {
  it('soft-deletes and hides the tree from non-owners', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const editor = await editorIn(treeId);
    const url = `/api/v1/trees/${treeId}`;
    expect((await call(app, 'DELETE', url, { jar: editor.jar })).statusCode).toBe(403);
    expect((await call(app, 'DELETE', url, { jar: owner.jar })).statusCode).toBe(204);
    expect((await call(app, 'GET', url, { jar: owner.jar })).statusCode).toBe(404);
    expect((await call(app, 'GET', url, { jar: editor.jar })).statusCode).toBe(404);
    const list = (await call(app, 'GET', '/api/v1/trees', { jar: owner.jar })).json();
    expect(list.trees).toEqual([]);
    expect(list.deletedTrees).toHaveLength(1);
    const d = list.deletedTrees[0];
    expect(new Date(d.restoreUntil).getTime() - new Date(d.deletedAt).getTime()).toBe(30 * DAY);
    const el = (await call(app, 'GET', '/api/v1/trees', { jar: editor.jar })).json();
    expect(el).toEqual({ trees: [], deletedTrees: [] });
  });

  it('restores within 30 days, owner only', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const editor = await editorIn(treeId);
    const url = `/api/v1/trees/${treeId}`;
    await call(app, 'DELETE', url, { jar: owner.jar });
    expect((await call(app, 'POST', `${url}/restore`, { jar: editor.jar })).statusCode).toBe(404);
    expect((await call(app, 'POST', `${url}/restore`, { jar: owner.jar })).statusCode).toBe(204);
    expect((await call(app, 'GET', url, { jar: owner.jar })).statusCode).toBe(200);
    // Not deleted: no-op.
    expect((await call(app, 'POST', `${url}/restore`, { jar: owner.jar })).statusCode).toBe(204);
  });

  it('refuses after 30 days', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    await call(app, 'DELETE', `/api/v1/trees/${treeId}`, { jar: owner.jar });
    await db
      .update(trees)
      .set({ deletedAt: sql`now() - interval '31 days'` })
      .where(eq(trees.id, treeId));
    expect(
      (await call(app, 'POST', `/api/v1/trees/${treeId}/restore`, { jar: owner.jar })).statusCode,
    ).toBe(404);
  });

  it('refuses when restoring would exceed the limit', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    await call(app, 'DELETE', `/api/v1/trees/${treeId}`, { jar: owner.jar });
    expect((await newTree(owner.jar, 'B')).statusCode).toBe(201);
    expect((await newTree(owner.jar, 'C')).statusCode).toBe(201);
    const res = await call(app, 'POST', `/api/v1/trees/${treeId}/restore`, { jar: owner.jar });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
  });
});
