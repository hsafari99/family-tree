import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import {
  addMember,
  addPerson,
  family,
  ownerWithTree,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { branchStewards } from '../db/schema.js';
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

/** Hale shape: Robert + Mary -> Dan; Dan + Ann -> Leo. George + Greta are a separate branch. */
async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const robert = await addPerson(db, treeId, 'Robert');
  const mary = await addPerson(db, treeId, 'Mary');
  const dan = await addPerson(db, treeId, 'Dan');
  const ann = await addPerson(db, treeId, 'Ann');
  const leo = await addPerson(db, treeId, 'Leo');
  const george = await addPerson(db, treeId, 'George');
  const greta = await addPerson(db, treeId, 'Greta');
  await family(db, treeId, robert, mary, [dan]);
  await family(db, treeId, dan, ann, [leo]);
  await family(db, treeId, george, greta);
  const S1 = await userWith2fa(app, 'Sam');
  const S2 = await userWith2fa(app, 'Sue');
  const S3 = await signUp(app, { name: 'Sid' });
  const E = await signUp(app, { name: 'Edie' });
  for (const u of [S1, S2, S3]) await addMember(db, treeId, u.userId, 'viewer', owner.userId);
  await addMember(db, treeId, E.userId, 'editor', owner.userId);
  return { owner, treeId, robert, leo, george, S1, S2, S3, E };
}

const url = (treeId: string) => `/api/v1/trees/${treeId}/stewards`;

describe('POST stewards', () => {
  it('lets the owner grant, and rejects bad grants', async () => {
    const { owner, treeId, robert, george, S1, E } = await setup();
    const grant = (jar = owner.jar, userId = S1.userId, anchorPersonId = robert.id) =>
      call(app, 'POST', url(treeId), { jar, body: { userId, anchorPersonId } });
    const ok = await grant();
    expect(ok.statusCode).toBe(201);
    const [row] = await db.select().from(branchStewards).where(eq(branchStewards.id, ok.json().id));
    expect(row?.parentGrantId).toBeNull();
    expect(row?.grantedByUserId).toBe(owner.userId);
    expect((await grant()).statusCode).toBe(409);
    expect((await grant()).json().error.code).toBe('CONFLICT');

    const other = await ownerWithTree(app, 'Other');
    const foreign = await addPerson(db, other.treeId, 'Foreign');
    const bad = await grant(owner.jar, S1.userId, foreign.id);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION');
    const stranger = await signUp(app, { name: 'Stranger' });
    expect((await grant(owner.jar, stranger.userId)).statusCode).toBe(404);
    expect((await grant(owner.jar, owner.userId)).statusCode).toBe(400);
    expect((await grant(E.jar, S1.userId, george.id)).statusCode).toBe(403);
  });

  it('derives grants inside the granter scope only', async () => {
    const { owner, treeId, robert, leo, george, S1, S2 } = await setup();
    const g1 = (
      await call(app, 'POST', url(treeId), {
        jar: owner.jar,
        body: { userId: S1.userId, anchorPersonId: robert.id },
      })
    ).json().id as string;
    const post = (userId: string, anchorPersonId: string) =>
      call(app, 'POST', url(treeId), { jar: S1.jar, body: { userId, anchorPersonId } });
    const derived = await post(S2.userId, leo.id);
    expect(derived.statusCode).toBe(201);
    const [row] = await db
      .select()
      .from(branchStewards)
      .where(eq(branchStewards.id, derived.json().id));
    expect(row?.parentGrantId).toBe(g1);
    expect(row?.grantedByUserId).toBe(S1.userId);
    expect((await post(S2.userId, george.id)).statusCode).toBe(403);
    expect((await post(S1.userId, leo.id)).statusCode).toBe(400);
  });

  it('keeps a grant inactive until the steward has 2FA', async () => {
    const { owner, treeId, robert, leo, S3, S2 } = await setup();
    const res = await call(app, 'POST', url(treeId), {
      jar: owner.jar,
      body: { userId: S3.userId, anchorPersonId: robert.id },
    });
    expect(res.statusCode).toBe(201);
    const list = (await call(app, 'GET', url(treeId), { jar: owner.jar })).json().stewards;
    expect(list.find((s: { userId: string }) => s.userId === S3.userId).active).toBe(false);
    const again = await call(app, 'POST', url(treeId), {
      jar: S3.jar,
      body: { userId: S2.userId, anchorPersonId: leo.id },
    });
    expect(again.statusCode).toBe(403);
  });
});

describe('GET stewards', () => {
  it('is readable by every member with names and active flag', async () => {
    const { owner, treeId, robert, S1, E } = await setup();
    await call(app, 'POST', url(treeId), {
      jar: owner.jar,
      body: { userId: S1.userId, anchorPersonId: robert.id },
    });
    const res = await call(app, 'GET', url(treeId), { jar: E.jar });
    expect(res.statusCode).toBe(200);
    const [s] = res.json().stewards;
    expect(s).toMatchObject({
      userName: 'Sam',
      anchorPersonId: robert.id,
      grantedByName: 'Owner',
      active: true,
    });
  });
});

describe('DELETE stewards', () => {
  it('follows who granted, and cascades to derived grants', async () => {
    const { owner, treeId, robert, leo, S1, S2 } = await setup();
    const g1 = (
      await call(app, 'POST', url(treeId), {
        jar: owner.jar,
        body: { userId: S1.userId, anchorPersonId: robert.id },
      })
    ).json().id as string;
    const mk = async () =>
      (
        await call(app, 'POST', url(treeId), {
          jar: S1.jar,
          body: { userId: S2.userId, anchorPersonId: leo.id },
        })
      ).json().id as string;
    const g2 = await mk();
    expect((await call(app, 'DELETE', `${url(treeId)}/${g1}`, { jar: S2.jar })).statusCode).toBe(
      403,
    );
    expect((await call(app, 'DELETE', `${url(treeId)}/${g2}`, { jar: S1.jar })).statusCode).toBe(
      204,
    );
    const g3 = await mk();
    expect((await call(app, 'DELETE', `${url(treeId)}/${g1}`, { jar: owner.jar })).statusCode).toBe(
      204,
    );
    const left = await db.select().from(branchStewards).where(eq(branchStewards.id, g3));
    expect(left).toHaveLength(0);

    const other = await ownerWithTree(app, 'Other');
    const op = await addPerson(db, other.treeId, 'X');
    const og = (
      await call(app, 'POST', url(other.treeId), {
        jar: other.owner.jar,
        body: {
          userId: (await addMemberUser(other.treeId, other.owner.userId)).userId,
          anchorPersonId: op.id,
        },
      })
    ).json().id as string;
    expect((await call(app, 'DELETE', `${url(treeId)}/${og}`, { jar: owner.jar })).statusCode).toBe(
      404,
    );
  });
});

async function addMemberUser(treeId: string, invitedBy: string) {
  const u = await signUp(app, { name: 'Extra' });
  await addMember(db, treeId, u.userId, 'viewer', invitedBy);
  return u;
}

describe('review fixes', () => {
  it('gives a non-member 404 everywhere', async () => {
    const { owner, treeId, robert, S1 } = await setup();
    const g = (
      await call(app, 'POST', url(treeId), {
        jar: owner.jar,
        body: { userId: S1.userId, anchorPersonId: robert.id },
      })
    ).json().id as string;
    const X = await signUp(app, { name: 'Xena' });
    expect((await call(app, 'GET', url(treeId), { jar: X.jar })).statusCode).toBe(404);
    expect(
      (
        await call(app, 'POST', url(treeId), {
          jar: X.jar,
          body: { userId: S1.userId, anchorPersonId: robert.id },
        })
      ).statusCode,
    ).toBe(404);
    expect((await call(app, 'DELETE', `${url(treeId)}/${g}`, { jar: X.jar })).statusCode).toBe(404);
  });

  it('refuses an editor, and a steward without 2FA, on revoke', async () => {
    const { owner, treeId, robert, leo, S1, S3, E } = await setup();
    const post = async (jar: typeof owner.jar, userId: string, anchorPersonId: string) =>
      (await call(app, 'POST', url(treeId), { jar, body: { userId, anchorPersonId } })).json()
        .id as string;
    const g1 = await post(owner.jar, S1.userId, robert.id);
    expect((await call(app, 'DELETE', `${url(treeId)}/${g1}`, { jar: E.jar })).statusCode).toBe(
      403,
    );
    // S3 has no 2FA: a grant the owner made on their behalf is not effective, so they can't revoke.
    const g3 = await post(owner.jar, S3.userId, leo.id);
    await db
      .update(branchStewards)
      .set({ grantedByUserId: S3.userId })
      .where(eq(branchStewards.id, g1));
    expect((await call(app, 'DELETE', `${url(treeId)}/${g1}`, { jar: S3.jar })).statusCode).toBe(
      403,
    );
    expect(g3).toBeDefined();
  });
});
