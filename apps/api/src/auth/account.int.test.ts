import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signUp, TEST_PASSWORD, type CookieJar } from '../../test/auth-helpers.js';
import {
  addGrant,
  addMember,
  addPerson,
  ownerWithTree,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { invites, persons, treeMembers, users } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { createAuth } from './auth.js';

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

const disable2fa = (jar: CookieJar, password = TEST_PASSWORD) =>
  call(app, 'POST', '/api/auth/two-factor/disable', { jar, body: { password } });
const deleteUser = (jar: CookieJar, body: Record<string, unknown> = { password: TEST_PASSWORD }) =>
  call(app, 'POST', '/api/auth/delete-user', { jar, body });
const me = async (jar: CookieJar) =>
  (await call(app, 'GET', '/api/v1/me', { jar })).json().user as {
    twoFactorEnabled: boolean;
    requiresTwoFactor: boolean;
  };

describe('keeping 2FA on', () => {
  it('stops owners turning 2FA off', async () => {
    const { owner } = await ownerWithTree(app);
    const res = await disable2fa(owner.jar);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('TWO_FACTOR_REQUIRED_FOR_ROLE');
    expect((await me(owner.jar)).twoFactorEnabled).toBe(true);
  });

  it('stops stewards too, even for an inactive grant', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const steward = await userWith2fa(app, 'Sam');
    await addMember(db, treeId, steward.userId, 'viewer', owner.userId);
    const anchor = await addPerson(db, treeId, 'Anchor');
    await addGrant(db, treeId, steward.userId, anchor.id, owner.userId);
    const res = await disable2fa(steward.jar);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('TWO_FACTOR_REQUIRED_FOR_ROLE');
    expect((await me(steward.jar)).twoFactorEnabled).toBe(true);
  });

  it('lets a plain editor turn it off', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const editor = await userWith2fa(app, 'Edie');
    await addMember(db, treeId, editor.userId, 'editor', owner.userId);
    expect((await disable2fa(editor.jar)).statusCode).toBe(200);
  });
});

describe('/me requiresTwoFactor', () => {
  it('is true for owners and grant holders, false for others', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const steward = await userWith2fa(app, 'Sam');
    await addMember(db, treeId, steward.userId, 'viewer', owner.userId);
    const anchor = await addPerson(db, treeId, 'Anchor');
    await addGrant(db, treeId, steward.userId, anchor.id, owner.userId);
    const fresh = await signUp(app);
    expect((await me(owner.jar)).requiresTwoFactor).toBe(true);
    expect((await me(steward.jar)).requiresTwoFactor).toBe(true);
    expect((await me(fresh.jar)).requiresTwoFactor).toBe(false);
  });

  it('is false for the old owner after a transfer', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const next = await userWith2fa(app, 'Nell');
    await addMember(db, treeId, next.userId, 'editor', owner.userId);
    const res = await call(app, 'POST', `/api/v1/trees/${treeId}/transfer`, {
      jar: owner.jar,
      body: { userId: next.userId },
    });
    expect(res.statusCode).toBe(204);
    expect((await me(owner.jar)).requiresTwoFactor).toBe(false);
    expect((await me(next.jar)).requiresTwoFactor).toBe(true);
  });
});

describe('/me after transfer with a second tree', () => {
  it('keeps requiresTwoFactor true for the old owner', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const second = await call(app, 'POST', '/api/v1/trees', {
      jar: owner.jar,
      body: { name: 'Second', person: { givenName: 'Sol', surname: 'Two' } },
    });
    expect(second.statusCode).toBe(201);
    const next = await userWith2fa(app, 'Nell');
    await addMember(db, treeId, next.userId, 'editor', owner.userId);
    const res = await call(app, 'POST', `/api/v1/trees/${treeId}/transfer`, {
      jar: owner.jar,
      body: { userId: next.userId },
    });
    expect(res.statusCode).toBe(204);
    expect((await me(owner.jar)).requiresTwoFactor).toBe(true);
  });
});

describe('account deletion', () => {
  it('also guards the delete-user callback', async () => {
    const user = await signUp(app);
    const res = await call(app, 'GET', '/api/auth/delete-user/callback?token=x', {
      jar: user.jar,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('PASSWORD_REQUIRED');
    expect(await db.select().from(users).where(eq(users.id, user.userId))).toHaveLength(1);
  });

  it('needs the right password', async () => {
    const user = await signUp(app);
    const none = await deleteUser(user.jar, {});
    expect(none.statusCode).toBe(400);
    expect(none.json().code).toBe('PASSWORD_REQUIRED');
    const wrong = await deleteUser(user.jar, { password: 'Wrong password!!1' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('INVALID_PASSWORD');
    expect(wrong.json().code).not.toBe(none.json().code);
    expect(await db.select().from(users).where(eq(users.id, user.userId))).toHaveLength(1);
  });

  it('is refused for owners of live trees, allowed once the tree is deleted', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const [person] = await db.select().from(persons).where(eq(persons.treeId, treeId));
    await db.update(persons).set({ createdBy: owner.userId }).where(eq(persons.id, person!.id));
    const blocked = await deleteUser(owner.jar);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('OWNS_TREES');
    expect(await db.select().from(users).where(eq(users.id, owner.userId))).toHaveLength(1);

    const del = await call(app, 'DELETE', `/api/v1/trees/${treeId}`, { jar: owner.jar });
    expect(del.statusCode).toBe(204);
    expect((await deleteUser(owner.jar)).statusCode).toBe(200);
    expect(await db.select().from(users).where(eq(users.id, owner.userId))).toHaveLength(0);
    expect(
      await db.select().from(treeMembers).where(eq(treeMembers.userId, owner.userId)),
    ).toHaveLength(0);
    const [after] = await db.select().from(persons).where(eq(persons.id, person!.id));
    expect(after?.createdBy).toBeNull();
  });

  it('lets an editor leave without touching the tree', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const editor = await signUp(app, { name: 'Edie' });
    await addMember(db, treeId, editor.userId, 'editor', owner.userId);
    await db.insert(invites).values({
      tokenHash: `hash-${editor.userId}`,
      treeId,
      role: 'viewer',
      createdByUserId: editor.userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const before = await db.select().from(persons).where(eq(persons.treeId, treeId));
    expect((await deleteUser(editor.jar)).statusCode).toBe(200);
    expect(
      await db.select().from(treeMembers).where(eq(treeMembers.userId, editor.userId)),
    ).toHaveLength(0);
    expect(await db.select().from(invites).where(eq(invites.treeId, treeId))).toHaveLength(0);
    expect(await db.select().from(persons).where(eq(persons.treeId, treeId))).toHaveLength(
      before.length,
    );
    expect(await db.select().from(treeMembers).where(eq(treeMembers.treeId, treeId))).toHaveLength(
      1,
    );
  });
});
