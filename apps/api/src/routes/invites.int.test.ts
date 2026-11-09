import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, type CookieJar, signUp } from '../../test/auth-helpers.js';
import {
  addGrant,
  addMember,
  addPerson,
  family,
  ownerWithTree,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { branchStewards, invites, persons, treeMembers } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { hashToken } from '../security/tokens.js';

const config = { ...loadConfig(), TRUST_PROXY: 1 };
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

/** Hale shape plus Emma (unlinked). S is a steward on Robert; E an editor. */
async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const robert = await addPerson(db, treeId, 'Robert');
  const dan = await addPerson(db, treeId, 'Dan');
  const leo = await addPerson(db, treeId, 'Leo');
  const george = await addPerson(db, treeId, 'George');
  const emma = await addPerson(db, treeId, 'Emma', { surname: 'Hale' });
  await family(db, treeId, robert, null, [dan]);
  await family(db, treeId, dan, null, [leo]);
  const S = await userWith2fa(app, 'Sam');
  const E = await signUp(app, { name: 'Edie' });
  await addMember(db, treeId, S.userId, 'viewer', owner.userId);
  await addMember(db, treeId, E.userId, 'editor', owner.userId);
  const grant = await addGrant(db, treeId, S.userId, robert.id, owner.userId);
  return { owner, treeId, robert, leo, george, emma, S, E, grant };
}

const url = (treeId: string) => `/api/v1/trees/${treeId}/invites`;
const create = (treeId: string, jar: CookieJar, body: Record<string, unknown>) =>
  call(app, 'POST', url(treeId), { jar, body });
const accept = (jar: CookieJar | undefined, token: string) =>
  call(app, 'POST', '/api/v1/invites/accept', { jar, body: { token } });
const memberOf = async (treeId: string, userId: string) =>
  (await db.select().from(treeMembers).where(eq(treeMembers.userId, userId))).find(
    (m) => m.treeId === treeId,
  );

describe('POST invites', () => {
  it('creates an invite and stores only the hash', async () => {
    const { owner, treeId } = await setup();
    const res = await create(treeId, owner.jar, { role: 'editor' });
    expect(res.statusCode).toBe(201);
    const { id, token, expiresAt } = res.json();
    expect(Math.abs(Date.parse(expiresAt) - (Date.now() + 7 * 86_400_000))).toBeLessThan(60_000);
    const [row] = await db.select().from(invites).where(eq(invites.id, id));
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.tokenHash).toBe(hashToken(token));
  });

  it('follows who may create', async () => {
    const t = await setup();
    expect((await create(t.treeId, t.E.jar, { role: 'viewer' })).statusCode).toBe(403);
    const ok = await create(t.treeId, t.S.jar, {
      role: 'viewer',
      stewardAnchorPersonId: t.leo.id,
    });
    expect(ok.statusCode).toBe(201);
    expect(
      (await create(t.treeId, t.S.jar, { role: 'viewer', stewardAnchorPersonId: t.george.id }))
        .statusCode,
    ).toBe(403);
    const other = await ownerWithTree(app, 'Other');
    const foreign = await addPerson(db, other.treeId, 'Foreign');
    expect(
      (await create(t.treeId, t.S.jar, { role: 'viewer', stewardAnchorPersonId: foreign.id }))
        .statusCode,
    ).toBe(403);
    const bad = await create(t.treeId, t.owner.jar, {
      role: 'viewer',
      stewardAnchorPersonId: foreign.id,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION');
  });

  it('rejects a target person that is already linked', async () => {
    const { owner, treeId } = await setup();
    const detail = (await call(app, 'GET', `/api/v1/trees/${treeId}`, { jar: owner.jar })).json();
    const res = await create(treeId, owner.jar, {
      role: 'viewer',
      targetPersonId: detail.tree.rootPersonId,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('GET / DELETE invites', () => {
  it('lists open invites by visibility', async () => {
    const { owner, treeId, S, E } = await setup();
    await create(treeId, owner.jar, { role: 'viewer' });
    await create(treeId, S.jar, { role: 'viewer' });
    const used = (await create(treeId, owner.jar, { role: 'viewer' })).json().id as string;
    const expired = (await create(treeId, owner.jar, { role: 'viewer' })).json().id as string;
    const revoked = (await create(treeId, owner.jar, { role: 'viewer' })).json().id as string;
    await db.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, used));
    await db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.id, expired));
    await call(app, 'DELETE', `${url(treeId)}/${revoked}`, { jar: owner.jar });
    const all = (await call(app, 'GET', url(treeId), { jar: owner.jar })).json().invites;
    expect(all).toHaveLength(2);
    expect(all.map((i: { createdByName: string }) => i.createdByName).sort()).toEqual([
      'Owner',
      'Sam',
    ]);
    const mine = (await call(app, 'GET', url(treeId), { jar: S.jar })).json().invites;
    expect(mine).toHaveLength(1);
    expect(mine[0].createdByName).toBe('Sam');
    expect((await call(app, 'GET', url(treeId), { jar: E.jar })).statusCode).toBe(403);
  });

  it('revokes by creator or owner, within the tree', async () => {
    const { owner, treeId, S } = await setup();
    const byOwner = (await create(treeId, owner.jar, { role: 'viewer' })).json().id as string;
    const byS = (await create(treeId, S.jar, { role: 'viewer' })).json().id as string;
    const del = (jar: CookieJar, id: string) =>
      call(app, 'DELETE', `${url(treeId)}/${id}`, { jar });
    expect((await del(S.jar, byOwner)).statusCode).toBe(403);
    expect((await del(S.jar, byS)).statusCode).toBe(204);
    expect((await del(owner.jar, byOwner)).statusCode).toBe(204);
    const other = await ownerWithTree(app, 'Other');
    const foreign = (await create(other.treeId, other.owner.jar, { role: 'viewer' })).json()
      .id as string;
    expect((await del(owner.jar, foreign)).statusCode).toBe(404);
  });
});

describe('POST invites/preview', () => {
  const preview = (token: string, headers: Record<string, string | undefined> = {}) =>
    call(app, 'POST', '/api/v1/invites/preview', { body: { token }, headers });

  it('describes a usable invite and refuses the rest', async () => {
    const { owner, treeId, emma } = await setup();
    const { token, id } = (
      await create(treeId, owner.jar, { role: 'editor', targetPersonId: emma.id })
    ).json();
    const res = await preview(token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      treeName: 'Test tree',
      role: 'editor',
      inviterName: 'Owner',
      steward: false,
      targetPersonName: 'Emma Hale',
    });
    const code = async (t: string) => (await preview(t)).json().error?.code;
    expect(await code('x'.repeat(30))).toBe('INVALID_INVITE');
    await db.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, id));
    expect(await code(token)).toBe('INVALID_INVITE');
    await db.update(invites).set({ usedAt: null, revokedAt: new Date() }).where(eq(invites.id, id));
    expect(await code(token)).toBe('INVALID_INVITE');
    await db
      .update(invites)
      .set({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.id, id));
    expect(await code(token)).toBe('INVALID_INVITE');
    await db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() + 100_000) })
      .where(eq(invites.id, id));
    expect((await preview(token)).statusCode).toBe(200);
    await call(app, 'DELETE', `/api/v1/trees/${treeId}`, { jar: owner.jar });
    expect(await code(token)).toBe('INVALID_INVITE');
  });

  it('needs an Origin and is rate limited', async () => {
    expect((await preview('x'.repeat(30), { origin: undefined })).statusCode).toBe(403);
    const ip = { 'x-forwarded-for': '198.51.100.7' };
    for (let i = 0; i < 30; i++) {
      expect((await preview('x'.repeat(30), ip)).statusCode).toBe(400);
    }
    expect((await preview('x'.repeat(30), ip)).statusCode).toBe(429);
  });
});

describe('POST invites/accept', () => {
  it('needs a session, joins a new user, and is single use', async () => {
    const { owner, treeId, emma } = await setup();
    const { token, id } = (
      await create(treeId, owner.jar, { role: 'editor', targetPersonId: emma.id })
    ).json();
    expect((await accept(undefined, token)).statusCode).toBe(401);
    const N = await signUp(app, { name: 'Newt' });
    const res = await accept(N.jar, token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ treeId });
    const m = await memberOf(treeId, N.userId);
    expect(m).toMatchObject({
      role: 'editor',
      personId: emma.id,
      invitedByUserId: owner.userId,
    });
    const [inv] = await db.select().from(invites).where(eq(invites.id, id));
    expect(inv?.usedAt).not.toBeNull();
    expect(inv?.usedByUserId).toBe(N.userId);
    const again = await accept(N.jar, token);
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('INVALID_INVITE');
  });

  it('only raises the role of existing members', async () => {
    const { owner, treeId, E } = await setup();
    const V = await signUp(app, { name: 'Vic' });
    await addMember(db, treeId, V.userId, 'viewer', owner.userId);
    const inv = async (role: string) =>
      (await create(treeId, owner.jar, { role })).json().token as string;
    expect((await accept(V.jar, await inv('editor'))).statusCode).toBe(200);
    expect((await memberOf(treeId, V.userId))?.role).toBe('editor');
    const viewerInv = await inv('viewer');
    expect((await accept(E.jar, viewerInv)).statusCode).toBe(200);
    expect((await memberOf(treeId, E.userId))?.role).toBe('editor');
    const [used] = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashToken(viewerInv)));
    expect(used?.usedAt).not.toBeNull();
  });

  it('leaves the owner alone', async () => {
    const t = await setup();
    // The owner of tree T accepts an invite to T made by a steward of T.
    const token = (
      await create(t.treeId, t.S.jar, { role: 'viewer', stewardAnchorPersonId: t.leo.id })
    ).json().token as string;
    expect((await accept(t.owner.jar, token)).statusCode).toBe(200);
    expect((await memberOf(t.treeId, t.owner.userId))?.role).toBe('owner');
    const grants = await db
      .select()
      .from(branchStewards)
      .where(eq(branchStewards.userId, t.owner.userId));
    expect(grants).toHaveLength(0);
  });

  it('creates steward grants with the right parent', async () => {
    const { owner, treeId, leo, robert, S, grant } = await setup();
    const fromS = (
      await create(treeId, S.jar, { role: 'viewer', stewardAnchorPersonId: leo.id })
    ).json().token as string;
    const A = await signUp(app, { name: 'Ann' });
    expect((await accept(A.jar, fromS)).statusCode).toBe(200);
    const [g] = await db.select().from(branchStewards).where(eq(branchStewards.userId, A.userId));
    expect(g).toMatchObject({
      anchorPersonId: leo.id,
      grantedByUserId: S.userId,
      parentGrantId: grant.id,
    });
    const fromOwner = (
      await create(treeId, owner.jar, { role: 'viewer', stewardAnchorPersonId: robert.id })
    ).json().token as string;
    const B = await signUp(app, { name: 'Bo' });
    expect((await accept(B.jar, fromOwner)).statusCode).toBe(200);
    const [g2] = await db.select().from(branchStewards).where(eq(branchStewards.userId, B.userId));
    expect(g2).toMatchObject({ grantedByUserId: owner.userId, parentGrantId: null });
  });

  it('re-checks the creator at acceptance', async () => {
    const { owner, treeId, S, grant } = await setup();
    const { token, id } = (await create(treeId, S.jar, { role: 'viewer' })).json();
    await db.delete(branchStewards).where(eq(branchStewards.id, grant.id));
    const N = await signUp(app, { name: 'Newt' });
    const res = await accept(N.jar, token);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_INVITE');
    const [inv] = await db.select().from(invites).where(eq(invites.id, id));
    expect(inv?.usedAt).toBeNull();
    expect(await memberOf(treeId, N.userId)).toBeUndefined();
    const own = (await create(treeId, owner.jar, { role: 'viewer' })).json().token as string;
    const self = await accept(owner.jar, own);
    expect(self.statusCode).toBe(400);
    expect(self.json().error.code).toBe('INVALID_INVITE');
  });

  it('lets exactly one of two concurrent accepts win', async () => {
    const { owner, treeId } = await setup();
    const token = (await create(treeId, owner.jar, { role: 'viewer' })).json().token as string;
    const [a, b] = [await signUp(app, { name: 'A' }), await signUp(app, { name: 'B' })];
    const res = await Promise.all([accept(a.jar, token), accept(b.jar, token)]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    const winner = res[0]!.statusCode === 200 ? a : b;
    const members = await db.select().from(treeMembers).where(eq(treeMembers.treeId, treeId));
    expect(members.filter((m) => [a.userId, b.userId].includes(m.userId))).toHaveLength(1);
    expect(await memberOf(treeId, winner.userId)).toBeDefined();
    const [inv] = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashToken(token)));
    expect(inv?.usedByUserId).toBe(winner.userId);
  });
});

describe('review fixes', () => {
  it('refuses a steward invite whose anchor was deleted', async () => {
    const { owner, treeId, leo } = await setup();
    const { token } = (
      await create(treeId, owner.jar, { role: 'viewer', stewardAnchorPersonId: leo.id })
    ).json();
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, leo.id));
    const N = await signUp(app, { name: 'Newt' });
    const res = await accept(N.jar, token);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_INVITE');
    expect(await memberOf(treeId, N.userId)).toBeUndefined();
  });

  it('does not touch the owner row on accept', async () => {
    const { owner, treeId, S, leo } = await setup();
    const token = (await create(treeId, S.jar, { role: 'editor', targetPersonId: leo.id })).json()
      .token as string;
    const before = await memberOf(treeId, owner.userId);
    expect((await accept(owner.jar, token)).statusCode).toBe(200);
    expect(await memberOf(treeId, owner.userId)).toEqual(before);
  });

  it('limits a steward to targets in their scope', async () => {
    const { treeId, S, george, leo } = await setup();
    expect(
      (await create(treeId, S.jar, { role: 'viewer', targetPersonId: george.id })).statusCode,
    ).toBe(403);
    expect(
      (await create(treeId, S.jar, { role: 'viewer', targetPersonId: leo.id })).statusCode,
    ).toBe(201);
  });

  it('gives a non-member 404 everywhere', async () => {
    const { owner, treeId } = await setup();
    const id = (await create(treeId, owner.jar, { role: 'viewer' })).json().id as string;
    const X = await signUp(app, { name: 'Xena' });
    expect((await call(app, 'GET', url(treeId), { jar: X.jar })).statusCode).toBe(404);
    expect((await create(treeId, X.jar, { role: 'viewer' })).statusCode).toBe(404);
    expect((await call(app, 'DELETE', `${url(treeId)}/${id}`, { jar: X.jar })).statusCode).toBe(
      404,
    );
  });

  it('gives a steward without 2FA no invite powers', async () => {
    const { owner, treeId, robert } = await setup();
    const T = await signUp(app, { name: 'Tess' });
    await addMember(db, treeId, T.userId, 'viewer', owner.userId);
    await addGrant(db, treeId, T.userId, robert.id, owner.userId);
    const id = (await create(treeId, owner.jar, { role: 'viewer' })).json().id as string;
    expect((await create(treeId, T.jar, { role: 'viewer' })).statusCode).toBe(403);
    expect((await call(app, 'GET', url(treeId), { jar: T.jar })).statusCode).toBe(403);
    expect((await call(app, 'DELETE', `${url(treeId)}/${id}`, { jar: T.jar })).statusCode).toBe(
      403,
    );
  });
});
