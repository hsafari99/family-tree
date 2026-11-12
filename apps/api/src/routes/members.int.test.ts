import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, type CookieJar, signUp } from '../../test/auth-helpers.js';
import { addGrant, addMember, ownerWithTree, userWith2fa } from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { branchStewards, invites, resetLinks, treeMembers, trees, users } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { hashToken, newToken } from '../security/tokens.js';

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

/** Owner's tree with E (editor), V (viewer), S (steward on the root, 2FA), W (viewer invited by S). */
async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const detail = (await call(app, 'GET', `/api/v1/trees/${treeId}`, { jar: owner.jar })).json();
  const rootId = detail.tree.rootPersonId as string;
  const E = await signUp(app, { name: 'Edie' });
  const V = await signUp(app, { name: 'Vic' });
  const S = await userWith2fa(app, 'Sam');
  const W = await signUp(app, { name: 'Wes' });
  await addMember(db, treeId, E.userId, 'editor', owner.userId);
  await addMember(db, treeId, V.userId, 'viewer', owner.userId);
  await addMember(db, treeId, S.userId, 'viewer', owner.userId);
  const grant = await addGrant(db, treeId, S.userId, rootId, owner.userId);
  await addMember(db, treeId, W.userId, 'viewer', S.userId);
  return { owner, treeId, rootId, E, V, S, W, grant };
}

const roleOf = async (treeId: string, userId: string) =>
  (
    await db
      .select({ role: treeMembers.role })
      .from(treeMembers)
      .where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, userId)))
  )[0]?.role;

const members = (treeId: string) => `/api/v1/trees/${treeId}/members`;

describe('GET members', () => {
  it('shows details only to the owner', async () => {
    const { owner, treeId, E } = await setup();
    const o = (await call(app, 'GET', members(treeId), { jar: owner.jar })).json().members;
    expect(o).toHaveLength(5);
    expect(o[0].role).toBe('owner');
    expect(o.every((m: object) => 'email' in m && 'twoFactorEnabled' in m)).toBe(true);
    const e = (await call(app, 'GET', members(treeId), { jar: E.jar })).json().members;
    expect(e).toHaveLength(5);
    expect(e.some((m: object) => 'email' in m || 'twoFactorEnabled' in m)).toBe(false);
  });

  it('says when each member joined, as an ISO date, to everyone (brief #19)', async () => {
    const { owner, treeId, E } = await setup();
    for (const jar of [owner.jar, E.jar]) {
      const list = (await call(app, 'GET', members(treeId), { jar })).json().members;
      for (const m of list as { joinedAt: unknown }[]) {
        expect(typeof m.joinedAt).toBe('string');
        expect(new Date(m.joinedAt as string).toISOString()).toBe(m.joinedAt);
      }
    }
  });
});

describe('PATCH member role', () => {
  it('follows the permission rules', async () => {
    const { owner, treeId, E, V, S, W } = await setup();
    const patch = (jar: CookieJar, id: string, role: string) =>
      call(app, 'PATCH', `${members(treeId)}/${id}`, { jar, body: { role } });
    expect((await patch(S.jar, W.userId, 'editor')).statusCode).toBe(204);
    expect(await roleOf(treeId, W.userId)).toBe('editor');
    expect((await patch(S.jar, V.userId, 'editor')).statusCode).toBe(403);
    expect((await patch(owner.jar, E.userId, 'viewer')).statusCode).toBe(204);
    expect(await roleOf(treeId, E.userId)).toBe('viewer');
    expect((await patch(owner.jar, owner.userId, 'viewer')).statusCode).toBe(403);
    expect((await patch(owner.jar, V.userId, 'owner')).statusCode).toBe(400);
    const unknown = await patch(owner.jar, '00000000-0000-4000-8000-000000000000', 'viewer');
    expect(unknown.statusCode).toBe(404);
  });
});

describe('DELETE member', () => {
  it('removes members, grants and open invites', async () => {
    const { owner, treeId, V, E, S, W } = await setup();
    const del = (jar: CookieJar, id: string) =>
      call(app, 'DELETE', `${members(treeId)}/${id}`, { jar });
    expect((await del(S.jar, W.userId)).statusCode).toBe(204);
    expect(await roleOf(treeId, W.userId)).toBeUndefined();

    const [inv] = await db
      .insert(invites)
      .values({
        tokenHash: hashToken(newToken()),
        treeId,
        role: 'viewer',
        createdByUserId: S.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    expect((await del(owner.jar, S.userId)).statusCode).toBe(204);
    expect(await roleOf(treeId, S.userId)).toBeUndefined();
    expect(
      await db.select().from(branchStewards).where(eq(branchStewards.userId, S.userId)),
    ).toHaveLength(0);
    const [after] = await db.select().from(invites).where(eq(invites.id, inv!.id));
    expect(after!.revokedAt).not.toBeNull();

    expect((await del(E.jar, V.userId)).statusCode).toBe(403);
    expect((await del(owner.jar, owner.userId)).statusCode).toBe(403);
  });
});

describe('POST transfer', () => {
  it('moves ownership to a member with 2FA', async () => {
    const { owner, treeId, rootId, E, S, grant } = await setup();
    const url = `/api/v1/trees/${treeId}/transfer`;
    const to = (jar: CookieJar, userId: string) =>
      call(app, 'POST', url, { jar, body: { userId } });

    const noTfa = await to(owner.jar, E.userId);
    expect(noTfa.statusCode).toBe(403);
    expect(noTfa.json().error.code).toBe('TWO_FACTOR_REQUIRED');
    expect((await to(owner.jar, owner.userId)).statusCode).toBe(400);
    expect((await to(E.jar, S.userId)).statusCode).toBe(403);

    const S2 = await signUp(app);
    await addMember(db, treeId, S2.userId, 'viewer', S.userId);
    const g2 = await addGrant(db, treeId, S2.userId, rootId, S.userId, grant.id);
    const [inv] = await db
      .insert(invites)
      .values({
        tokenHash: hashToken(newToken()),
        treeId,
        role: 'viewer',
        createdByUserId: owner.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();

    expect((await to(owner.jar, S.userId)).statusCode).toBe(204);
    expect(await roleOf(treeId, S.userId)).toBe('owner');
    expect(await roleOf(treeId, owner.userId)).toBe('editor');
    expect(
      await db.select().from(branchStewards).where(eq(branchStewards.userId, S.userId)),
    ).toHaveLength(0);
    const [survivor] = await db.select().from(branchStewards).where(eq(branchStewards.id, g2.id));
    expect(survivor).toBeDefined();
    expect(survivor!.parentGrantId).toBeNull();
    const [after] = await db.select().from(invites).where(eq(invites.id, inv!.id));
    expect(after!.revokedAt).not.toBeNull();
    const owners = await db
      .select()
      .from(treeMembers)
      .where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.role, 'owner')));
    expect(owners).toHaveLength(1);
    const d = (await call(app, 'GET', `/api/v1/trees/${treeId}`, { jar: owner.jar })).json();
    expect(d.capabilities.manageTree).toBe(false);
  });
});

describe('transfer limits and steward edge cases', () => {
  it('refuses a transfer to a member who already owns the maximum number of trees', async () => {
    const { owner, treeId, S } = await setup();
    for (let i = 0; i < config.MAX_TREES_PER_USER; i++) {
      const [t] = await db
        .insert(trees)
        .values({ name: `Full ${i}` })
        .returning();
      await db.insert(treeMembers).values({ treeId: t!.id, userId: S.userId, role: 'owner' });
    }
    const res = await call(app, 'POST', `/api/v1/trees/${treeId}/transfer`, {
      jar: owner.jar,
      body: { userId: S.userId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
    expect(await roleOf(treeId, owner.userId)).toBe('owner');
  });

  it('a steward without 2FA cannot change the role of a member they invited', async () => {
    const { treeId, S, W } = await setup();
    await db.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, S.userId));
    const res = await call(app, 'PATCH', `${members(treeId)}/${W.userId}`, {
      jar: S.jar,
      body: { role: 'editor' },
    });
    expect(res.statusCode).toBe(403);
    expect(await roleOf(treeId, W.userId)).toBe('viewer');
  });

  it('removing a steward also removes grants that steward made', async () => {
    const { owner, treeId, rootId, S, W, grant } = await setup();
    const child = await addGrant(db, treeId, W.userId, rootId, S.userId, grant.id);
    const res = await call(app, 'DELETE', `${members(treeId)}/${S.userId}`, { jar: owner.jar });
    expect(res.statusCode).toBe(204);
    expect(await db.select().from(branchStewards).where(eq(branchStewards.id, child.id))).toEqual(
      [],
    );
  });
});

describe('owner reset links are re-checked on use', () => {
  const issue = async (jar: CookieJar, treeId: string, userId: string) =>
    (
      await call(app, 'POST', `/api/v1/trees/${treeId}/members/${userId}/reset-link`, { jar })
    ).json().token as string;
  const redeem = (token: string) =>
    call(app, 'POST', '/api/v1/password-reset/link', {
      body: { token, newPassword: 'A brand new passphrase1' },
    });
  const expectInvalid = async (token: string) => {
    const res = await redeem(token);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_RESET');
  };

  it('fails if the target has since joined another owner’s tree', async () => {
    const { owner, treeId, V } = await setup();
    const token = await issue(owner.jar, treeId, V.userId);
    const other = await ownerWithTree(app, 'Other');
    await addMember(db, other.treeId, V.userId, 'viewer');
    await expectInvalid(token);
  });

  it('fails if the target has since enabled 2FA', async () => {
    const { owner, treeId, V } = await setup();
    const token = await issue(owner.jar, treeId, V.userId);
    await db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, V.userId));
    await expectInvalid(token);
  });

  it('fails if the issuer no longer owns the tree', async () => {
    const { owner, treeId, V, S } = await setup();
    const token = await issue(owner.jar, treeId, V.userId);
    const t = await call(app, 'POST', `/api/v1/trees/${treeId}/transfer`, {
      jar: owner.jar,
      body: { userId: S.userId },
    });
    expect(t.statusCode).toBe(204);
    await expectInvalid(token);
  });
});

describe('POST reset-link', () => {
  const issue = (jar: CookieJar, treeId: string, userId: string) =>
    call(app, 'POST', `/api/v1/trees/${treeId}/members/${userId}/reset-link`, { jar });

  it('issues for a 2FA-less member who belongs only to the owner’s trees', async () => {
    const { owner, treeId, V } = await setup();
    const res = await issue(owner.jar, treeId, V.userId);
    expect(res.statusCode).toBe(201);
    const { token, expiresAt } = res.json();
    expect(expiresAt).toBeTruthy();
    const [row] = await db
      .select()
      .from(resetLinks)
      .where(eq(resetLinks.tokenHash, hashToken(token)));
    expect(row).toMatchObject({ treeId, createdByUserId: owner.userId, userId: V.userId });
    const use = await call(app, 'POST', '/api/v1/password-reset/link', {
      body: { token, newPassword: 'A brand new passphrase1' },
    });
    expect(use.statusCode).toBe(204);
  });

  it('refuses 2FA members, foreign trees, yourself, and non-owners', async () => {
    const { owner, treeId, V, E, S } = await setup();
    const tfa = await issue(owner.jar, treeId, S.userId);
    expect(tfa.statusCode).toBe(403);
    expect(tfa.json().error.code).toBe('RESET_LINK_NOT_ALLOWED');
    expect((await issue(owner.jar, treeId, owner.userId)).json().error.code).toBe(
      'RESET_LINK_NOT_ALLOWED',
    );
    const ed = await issue(E.jar, treeId, V.userId);
    expect(ed.statusCode).toBe(403);
    expect(ed.json().error.code).toBe('FORBIDDEN');

    const other = await ownerWithTree(app, 'Other');
    await addMember(db, other.treeId, V.userId, 'viewer');
    const foreign = await issue(owner.jar, treeId, V.userId);
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.code).toBe('RESET_LINK_NOT_ALLOWED');
  });

  it('allows a member of a second tree the same owner owns', async () => {
    const { owner, treeId, V } = await setup();
    const second = await call(app, 'POST', '/api/v1/trees', {
      jar: owner.jar,
      body: { name: 'Second', person: { givenName: 'Sec' } },
    });
    await addMember(db, second.json().tree.id, V.userId, 'viewer');
    expect((await issue(owner.jar, treeId, V.userId)).statusCode).toBe(201);
  });

  it('limits an owner to 10 per hour', async () => {
    const { owner, treeId, V } = await setup();
    for (let i = 0; i < 10; i++) {
      expect((await issue(owner.jar, treeId, V.userId)).statusCode).toBe(201);
    }
    expect((await issue(owner.jar, treeId, V.userId)).statusCode).toBe(429);
  });
});
