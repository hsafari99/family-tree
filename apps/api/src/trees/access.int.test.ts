import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { enableTwoFactor, signUp } from '../../test/auth-helpers.js';
import { addGrant, addMember, addPerson, family } from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { treeMembers, trees, users } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { AppError } from '../errors.js';
import { authorize, grantCovering, loadAccess } from './access.js';
import { branchPersonIds } from './branch.js';

const config = loadConfig();
const deps = createDeps(config);
const { db } = deps;
const auth = createAuth({ config, db, rateLimitEnabled: false });
const app = buildApp({ config, checks: deps.checks, auth, db });

const treeIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  await app.ready();
});
afterEach(async () => {
  const t = treeIds.splice(0);
  if (t.length > 0) await db.delete(trees).where(inArray(trees.id, t));
  const u = userIds.splice(0);
  if (u.length > 0) await db.delete(users).where(inArray(users.id, u));
});
afterAll(async () => {
  await app.close();
  await deps.close();
});

async function newUser(withTwoFactor: boolean) {
  const u = await signUp(app);
  userIds.push(u.userId);
  if (withTwoFactor) await enableTwoFactor(app, u.jar, u.password);
  return u.userId;
}

/** A tree with an owner and the Hale shape (robert → david, laura (adopted in) → leo, mia, zoe). */
async function haleTree() {
  const owner = await newUser(true);
  const [t] = await db.insert(trees).values({ name: 'Access test' }).returning();
  const treeId = t!.id;
  treeIds.push(treeId);
  await db.insert(treeMembers).values({ treeId, userId: owner, role: 'owner' });
  const P = async (n: string) => addPerson(db, treeId, n);
  const [robert, margaret, david, laura, george, helen, leo, mia, zoe] = await Promise.all(
    ['robert', 'margaret', 'david', 'laura', 'george', 'helen', 'leo', 'mia', 'zoe'].map(P),
  );
  await family(db, treeId, robert!, margaret!, [david!]);
  await family(db, treeId, george!, helen!, [laura!]);
  await family(db, treeId, david!, laura!, [leo!, mia!]);
  await family(db, treeId, leo!, zoe!);
  return {
    owner,
    treeId,
    robert: robert!,
    laura: laura!,
    george: george!,
    leo: leo!,
    zoe: zoe!,
    mia: mia!,
  };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.statusCode;
    throw e;
  }
  return null;
};

describe('loadAccess', () => {
  it('404s for a non-member and for a member of a deleted tree', async () => {
    const h = await haleTree();
    const stranger = await newUser(false);
    expect(await status(loadAccess(db, h.treeId, stranger))).toBe(404);
    await db.update(trees).set({ deletedAt: new Date() }).where(eq(trees.id, h.treeId));
    expect(await status(loadAccess(db, h.treeId, h.owner))).toBe(404);
  });

  it('returns a deleted tree with includeDeleted', async () => {
    const h = await haleTree();
    await db.update(trees).set({ deletedAt: new Date() }).where(eq(trees.id, h.treeId));
    const a = await loadAccess(db, h.treeId, h.owner, { includeDeleted: true });
    expect(a.role).toBe('owner');
    expect(a.deletedAt).not.toBeNull();
  });

  it('gives the owner role owner and no grants', async () => {
    const h = await haleTree();
    const a = await loadAccess(db, h.treeId, h.owner);
    expect(a.role).toBe('owner');
    expect(a.grants).toEqual([]);
  });

  it('a steward without 2FA holds a grant but has no effective grant', async () => {
    const h = await haleTree();
    const s = await newUser(false);
    await addMember(db, h.treeId, s, 'viewer', h.owner);
    await addGrant(db, h.treeId, s, h.robert.id, h.owner);
    const a = await loadAccess(db, h.treeId, s);
    expect(a.heldGrants).toHaveLength(1);
    expect(a.grants).toHaveLength(0);
  });

  it('a steward with 2FA gets the branch of the anchor as scope', async () => {
    const h = await haleTree();
    const s = await newUser(true);
    await addMember(db, h.treeId, s, 'viewer', h.owner);
    await addGrant(db, h.treeId, s, h.robert.id, h.owner);
    const a = await loadAccess(db, h.treeId, s);
    expect(a.grants).toHaveLength(1);
    expect(a.grants[0]!.scope).toEqual(await branchPersonIds(db, h.treeId, h.robert.id, s));
  });

  it('a derived grant is limited to the intersection with its parent grant', async () => {
    const h = await haleTree();
    const s1 = await newUser(true);
    const s2 = await newUser(true);
    await addMember(db, h.treeId, s1, 'viewer', h.owner);
    await addMember(db, h.treeId, s2, 'viewer', s1);
    const parent = await addGrant(db, h.treeId, s1, h.robert.id, h.owner);
    await addGrant(db, h.treeId, s2, h.laura.id, s1, parent.id);
    const a = await loadAccess(db, h.treeId, s2);
    const scope = a.grants[0]!.scope;
    expect(scope.has(h.leo.id)).toBe(true);
    expect(scope.has(h.mia.id)).toBe(true);
    expect(scope.has(h.zoe.id)).toBe(true);
    expect(scope.has(h.laura.id)).toBe(false);
    expect(scope.has(h.george.id)).toBe(false);
  });

  it('grantCovering finds the grant containing a person', async () => {
    const h = await haleTree();
    const s = await newUser(true);
    await addMember(db, h.treeId, s, 'viewer', h.owner);
    await addGrant(db, h.treeId, s, h.laura.id, h.owner);
    const a = await loadAccess(db, h.treeId, s);
    expect(grantCovering(a, h.george.id)?.anchorPersonId).toBe(h.laura.id);
    expect(grantCovering(a, h.robert.id)).toBeUndefined();
  });

  it('authorize throws 403 when can() says no', async () => {
    const h = await haleTree();
    const e = await newUser(false);
    await addMember(db, h.treeId, e, 'editor', h.owner);
    const a = await loadAccess(db, h.treeId, e);
    expect(
      await status(Promise.resolve().then(() => authorize(a, 'tree.delete', { kind: 'tree' }))),
    ).toBe(403);
  });
});
