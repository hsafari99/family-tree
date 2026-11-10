import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signUp, type CookieJar } from '../../test/auth-helpers.js';
import { addPhotoRow, objectExists } from '../../test/photo-helpers.js';
import {
  addGrant,
  addMember,
  addPerson,
  auditRows,
  family,
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
  parentChild,
  persons,
  photos,
  storageDeletions,
  treeMembers,
  unions,
} from '../db/schema.js';
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

/** Robert + Mary -> Dan; Dan + Ann -> Leo; George + Greta -> Ann; Dan + (none) -> Kim; Leo + Zoe. */
async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const [robert, mary, dan, ann, leo, george, greta, kim, zoe] = await Promise.all(
    ['Robert', 'Mary', 'Dan', 'Ann', 'Leo', 'George', 'Greta', 'Kim', 'Zoe'].map((n) =>
      addPerson(db, treeId, n),
    ),
  );
  await family(db, treeId, robert!, mary!, [dan!]);
  const danAnn = await family(db, treeId, dan!, ann!, [leo!]);
  await family(db, treeId, george!, greta!, [ann!]);
  const danKim = await family(db, treeId, dan!, null, [kim!]);
  const leoZoe = await family(db, treeId, leo!, zoe!);
  const S = await userWith2fa(app, 'Sam');
  const E = await signUp(app, { name: 'Edie' });
  await addMember(db, treeId, S.userId, 'viewer', owner.userId);
  await addMember(db, treeId, E.userId, 'editor', owner.userId);
  await addGrant(db, treeId, S.userId, robert!.id, owner.userId);
  return {
    owner,
    treeId,
    S,
    E,
    danAnn,
    danKim,
    leoZoe,
    p: { robert: robert!, dan: dan!, ann: ann!, leo: leo!, kim: kim!, zoe: zoe! },
  };
}

const base = (t: string) => `/api/v1/trees/${t}`;
const trash = (t: string, b = '') => `${base(t)}/trash${b ? `/${b}` : ''}`;
const delPerson = async (jar: CookieJar, t: string, id: string) => {
  const r = await call(app, 'POST', `${base(t)}/persons/${id}/delete`, {
    jar,
    body: { mode: 'person' },
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().batchId as string;
};
const delUnion = async (jar: CookieJar, t: string, id: string) => {
  const r = await call(app, 'POST', `${base(t)}/unions/${id}/delete`, { jar });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().batchId as string;
};
const snapshot = async (treeId: string) => {
  const by = <T extends { id: string }>(a: T[]) => a.sort((x, y) => x.id.localeCompare(y.id));
  return {
    p: by(
      await db
        .select({ id: persons.id, d: persons.deletedAt })
        .from(persons)
        .where(eq(persons.treeId, treeId)),
    ),
    u: by(
      await db
        .select({ id: unions.id, d: unions.deletedAt, a: unions.partnerAId, b: unions.partnerBId })
        .from(unions)
        .where(eq(unions.treeId, treeId)),
    ),
    l: by(
      await db
        .select({ id: parentChild.id, d: parentChild.deletedAt })
        .from(parentChild)
        .where(eq(parentChild.treeId, treeId)),
    ),
  };
};

describe('trash list and detail', () => {
  it('lists batches newest first, with details', async () => {
    const { owner, treeId, leoZoe, p } = await setup();
    const b1 = await delPerson(owner.jar, treeId, p.dan.id);
    const b2 = await delUnion(owner.jar, treeId, leoZoe.id);
    const list = (await call(app, 'GET', trash(treeId), { jar: owner.jar })).json().batches;
    expect(list.map((b: { id: string }) => b.id)).toEqual([b2, b1]);
    expect(list[1]).toMatchObject({
      root: { kind: 'person', name: 'Dan' },
      people: 1,
      unions: 1,
      links: 2,
      deletedBy: 'Owner',
    });
    expect(list[0].root).toEqual({ kind: 'union', partners: ['Leo', 'Zoe'] });

    const d = (await call(app, 'GET', trash(treeId, b1), { jar: owner.jar })).json();
    expect(d.people.map((x: { id: string }) => x.id)).toEqual([p.dan.id]);
    expect(d.unions.map((u: { partners: string[] }) => u.partners)).toEqual([['Dan']]);
    expect(d.links).toHaveLength(2);
    expect(d.slots).toBe(1);
  });
});

describe('restore', () => {
  it('restores a batch and puts the slot back', async () => {
    const { owner, treeId, danAnn, danKim, p } = await setup();
    const b = await delPerson(owner.jar, treeId, p.dan.id);
    const res = await call(app, 'POST', `${trash(treeId, b)}/restore`, { jar: owner.jar });
    expect(res.statusCode).toBe(204);
    const [dan] = await db.select().from(persons).where(eq(persons.id, p.dan.id));
    expect(dan).toMatchObject({ deletedAt: null, deletionBatchId: null });
    const [uk] = await db.select().from(unions).where(eq(unions.id, danKim.id));
    expect(uk).toMatchObject({ deletedAt: null, deletionBatchId: null });
    const [ua] = await db.select().from(unions).where(eq(unions.id, danAnn.id));
    expect(ua!.partnerAId).toBe(p.dan.id);
    const links = await db.select().from(parentChild).where(eq(parentChild.treeId, treeId));
    expect(links.every((l) => l.deletedAt === null && l.deletionBatchId === null)).toBe(true);
    const [batch] = await db.select().from(deletionBatches).where(eq(deletionBatches.id, b));
    expect(batch!.restoredAt).not.toBeNull();
    expect((await call(app, 'GET', trash(treeId), { jar: owner.jar })).json().batches).toEqual([]);
    expect((await auditRows(db, treeId)).some((r) => r.action === 'trash.restore')).toBe(true);
    expect(
      (await call(app, 'POST', `${trash(treeId, b)}/restore`, { jar: owner.jar })).statusCode,
    ).toBe(404);
  });

  it('refuses when the emptied slot was filled meanwhile', async () => {
    const { owner, treeId, danAnn, p } = await setup();
    const b = await delPerson(owner.jar, treeId, p.dan.id);
    const add = await call(app, 'POST', `${base(treeId)}/persons`, {
      jar: owner.jar,
      body: {
        person: { givenName: 'New' },
        attach: { to: p.leo.id, as: 'parent', unionId: danAnn.id },
      },
    });
    expect(add.statusCode, add.body).toBe(201);
    const before = await snapshot(treeId);
    const res = await call(app, 'POST', `${trash(treeId, b)}/restore`, { jar: owner.jar });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
    expect(await snapshot(treeId)).toEqual(before);
  });

  it('refuses a duplicate link', async () => {
    const { owner, treeId, danAnn, p } = await setup();
    const [link] = await db.select().from(parentChild).where(eq(parentChild.childId, p.leo.id));
    const r = await call(app, 'POST', `${base(treeId)}/parent-child/${link!.id}/delete`, {
      jar: owner.jar,
    });
    const b = r.json().batchId as string;
    const re = await call(app, 'POST', `${base(treeId)}/persons/${p.dan.id}/relatives`, {
      jar: owner.jar,
      body: { personId: p.leo.id, as: 'child', unionId: danAnn.id },
    });
    expect(re.statusCode, re.body).toBe(204);
    const before = await snapshot(treeId);
    const res = await call(app, 'POST', `${trash(treeId, b)}/restore`, { jar: owner.jar });
    expect(res.statusCode).toBe(409);
    expect(await snapshot(treeId)).toEqual(before);
  });

  it('refuses a restore that would make a cycle', async () => {
    const { owner, treeId, p } = await setup();
    const [link] = await db.select().from(parentChild).where(eq(parentChild.childId, p.leo.id));
    const r = await call(app, 'POST', `${base(treeId)}/parent-child/${link!.id}/delete`, {
      jar: owner.jar,
    });
    const b = r.json().batchId as string;
    const add = await call(app, 'POST', `${base(treeId)}/persons/${p.leo.id}/relatives`, {
      jar: owner.jar,
      body: { personId: p.dan.id, as: 'child' },
    });
    expect(add.statusCode, add.body).toBe(204);
    const before = await snapshot(treeId);
    const res = await call(app, 'POST', `${trash(treeId, b)}/restore`, { jar: owner.jar });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
    expect(await snapshot(treeId)).toEqual(before);
    const list = (await call(app, 'GET', trash(treeId), { jar: owner.jar })).json().batches;
    expect(list.map((x: { id: string }) => x.id)).toContain(b);
  });

  it('restores in either order', async () => {
    const { owner, treeId, danAnn, p } = await setup();
    const bAnn = await delPerson(owner.jar, treeId, p.ann.id);
    const bDan = await delPerson(owner.jar, treeId, p.dan.id);
    const [u1] = await db.select().from(unions).where(eq(unions.id, danAnn.id));
    expect(u1!.deletionBatchId).toBe(bDan);
    expect(
      (await call(app, 'POST', `${trash(treeId, bAnn)}/restore`, { jar: owner.jar })).statusCode,
    ).toBe(204);
    const [u2] = await db.select().from(unions).where(eq(unions.id, danAnn.id));
    expect(u2!.deletedAt).not.toBeNull();
    expect(u2!.partnerBId).toBe(p.ann.id);
    expect(
      (await call(app, 'POST', `${trash(treeId, bDan)}/restore`, { jar: owner.jar })).statusCode,
    ).toBe(204);
    const [u3] = await db.select().from(unions).where(eq(unions.id, danAnn.id));
    expect(u3).toMatchObject({ deletedAt: null, partnerAId: p.dan.id, partnerBId: p.ann.id });
  });
});

describe('erase', () => {
  it('erases a batch with its cards, invites, grants and audit rows', async () => {
    const { owner, treeId, S, p } = await setup();
    const edit = await call(app, 'PATCH', `${base(treeId)}/persons/${p.dan.id}`, {
      jar: owner.jar,
      body: { version: 1, surname: 'Hale' },
    });
    expect(edit.statusCode).toBe(200);
    const card = await signUp(app, { name: 'Cara' });
    await addMember(db, treeId, card.userId, 'viewer', owner.userId);
    await db
      .update(treeMembers)
      .set({ personId: p.dan.id })
      .where(eq(treeMembers.userId, card.userId));
    const mk = (extra: Partial<typeof invites.$inferInsert>) =>
      db.insert(invites).values({
        treeId,
        role: 'viewer',
        tokenHash: crypto.randomUUID(),
        createdByUserId: owner.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
        ...extra,
      });
    await mk({ role: 'editor', stewardAnchorPersonId: p.dan.id });
    await mk({ targetPersonId: p.dan.id });
    const parent = await addGrant(db, treeId, S.userId, p.dan.id, owner.userId);
    const u2 = await userWith2fa(app, 'Una');
    await addMember(db, treeId, u2.userId, 'viewer', owner.userId);
    await addGrant(db, treeId, u2.userId, p.kim.id, S.userId, parent.id);
    const grantsBefore = (
      await db.select().from(branchStewards).where(eq(branchStewards.treeId, treeId))
    ).length;

    const b = await delPerson(owner.jar, treeId, p.dan.id);
    const res = await call(app, 'DELETE', trash(treeId, b), { jar: owner.jar });
    expect(res.statusCode).toBe(204);

    const [m] = await db.select().from(treeMembers).where(eq(treeMembers.userId, card.userId));
    expect(m!.personId).toBeNull();
    expect(await db.select().from(invites).where(eq(invites.treeId, treeId))).toHaveLength(0);
    const grants = await db.select().from(branchStewards).where(eq(branchStewards.treeId, treeId));
    expect(grants.length).toBe(grantsBefore - 2 - 0); // Dan-anchored grant and its derived one; Robert's stays
    expect(await db.select().from(persons).where(eq(persons.id, p.dan.id))).toHaveLength(0);
    expect(await db.select().from(deletionBatches).where(eq(deletionBatches.id, b))).toHaveLength(
      0,
    );
    const rows = await db.select().from(auditLog).where(eq(auditLog.treeId, treeId));
    expect(rows.some((r) => r.entityId === p.dan.id)).toBe(false);
    expect(rows.some((r) => r.personIds.includes(p.dan.id))).toBe(false);
    const actions = rows.map((r) => r.action);
    expect(actions.filter((a) => a === 'trash.erase')).toHaveLength(1);
    expect(actions.filter((a) => a === 'steward.revoke')).toHaveLength(2);
    expect(actions.filter((a) => a === 'invite.revoke')).toHaveLength(2);
  });

  it('never destroys a live union that still holds an erased person', async () => {
    const { owner, treeId, leoZoe, p } = await setup();
    const b1 = await delUnion(owner.jar, treeId, leoZoe.id);
    const b2 = await delPerson(owner.jar, treeId, p.zoe.id);
    expect(
      (await call(app, 'POST', `${trash(treeId, b1)}/restore`, { jar: owner.jar })).statusCode,
    ).toBe(204);
    const [mid] = await db.select().from(unions).where(eq(unions.id, leoZoe.id));
    expect(mid).toMatchObject({ deletedAt: null, partnerBId: p.zoe.id });
    expect((await call(app, 'DELETE', trash(treeId, b2), { jar: owner.jar })).statusCode).toBe(204);
    const [u] = await db.select().from(unions).where(eq(unions.id, leoZoe.id));
    expect(u).toMatchObject({ deletedAt: null, partnerAId: p.leo.id, partnerBId: null });
  });
});

describe('permissions', () => {
  it('is owner-only, and scoped to the tree', async () => {
    const { owner, treeId, S, E, p } = await setup();
    const b = await delPerson(owner.jar, treeId, p.kim.id);
    for (const jar of [S.jar, E.jar]) {
      expect((await call(app, 'GET', trash(treeId), { jar })).statusCode).toBe(403);
      expect((await call(app, 'GET', trash(treeId, b), { jar })).statusCode).toBe(403);
      expect((await call(app, 'POST', `${trash(treeId, b)}/restore`, { jar })).statusCode).toBe(
        403,
      );
      expect((await call(app, 'DELETE', trash(treeId, b), { jar })).statusCode).toBe(403);
    }
    const outsider = await signUp(app, { name: 'Out' });
    expect((await call(app, 'GET', trash(treeId), { jar: outsider.jar })).statusCode).toBe(404);
    const other = await ownerWithTree(app, 'Other');
    const op = await addPerson(db, other.treeId, 'Zed');
    const ob = await softDeleteBatch(db, other.treeId, other.owner.userId, [op.id]);
    expect((await call(app, 'GET', trash(treeId, ob.id), { jar: owner.jar })).statusCode).toBe(404);
    expect(
      (await call(app, 'POST', `${trash(treeId, ob.id)}/restore`, { jar: owner.jar })).statusCode,
    ).toBe(404);
    expect((await call(app, 'DELETE', trash(treeId, ob.id), { jar: owner.jar })).statusCode).toBe(
      404,
    );
  });
});

describe('trash review fixes', () => {
  it('refuses a restore that would leave two live unions of one couple', async () => {
    const { owner, treeId, leoZoe, p } = await setup();
    const b = await delUnion(owner.jar, treeId, leoZoe.id);
    const add = await call(app, 'POST', `${base(treeId)}/persons/${p.leo.id}/relatives`, {
      jar: owner.jar,
      body: { personId: p.zoe.id, as: 'partner' },
    });
    expect(add.statusCode, add.body).toBe(204);
    const before = await snapshot(treeId);
    const res = await call(app, 'POST', `${trash(treeId, b)}/restore`, { jar: owner.jar });
    expect(res.statusCode).toBe(409);
    expect(await snapshot(treeId)).toEqual(before);
  });

  it('restores a relation batch whose link was cascaded away by an erase', async () => {
    const { owner, treeId, p } = await setup();
    const [link] = await db.select().from(parentChild).where(eq(parentChild.childId, p.kim.id));
    const r = await call(app, 'POST', `${base(treeId)}/parent-child/${link!.id}/delete`, {
      jar: owner.jar,
    });
    const rel = r.json().batchId as string;
    const pb = await delPerson(owner.jar, treeId, p.kim.id);
    expect((await call(app, 'DELETE', trash(treeId, pb), { jar: owner.jar })).statusCode).toBe(204);
    const before = await snapshot(treeId);
    const res = await call(app, 'POST', `${trash(treeId, rel)}/restore`, { jar: owner.jar });
    expect(res.statusCode, res.body).toBe(204);
    expect(await snapshot(treeId)).toEqual(before);
  });

  it('changes nothing outside the batch when erasing, and audits only open invites', async () => {
    const { owner, treeId, p } = await setup();
    const mk = (extra: Partial<typeof invites.$inferInsert>) =>
      db.insert(invites).values({
        treeId,
        role: 'viewer',
        tokenHash: crypto.randomUUID(),
        createdByUserId: owner.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
        targetPersonId: p.kim.id,
        ...extra,
      });
    await mk({});
    await mk({ revokedAt: new Date() });
    const joiner = await signUp(app, { name: 'Used' });
    await mk({ usedAt: new Date(), usedByUserId: joiner.userId });
    const b = await delPerson(owner.jar, treeId, p.kim.id);
    const outside = async () => {
      const live = await snapshot(treeId);
      const inBatch = new Set(
        (
          await db.select({ id: persons.id }).from(persons).where(eq(persons.deletionBatchId, b))
        ).map((x) => x.id),
      );
      return { ...live, p: live.p.filter((x) => !inBatch.has(x.id)) };
    };
    const before = await outside();
    expect((await call(app, 'DELETE', trash(treeId, b), { jar: owner.jar })).statusCode).toBe(204);
    const after = await outside();
    // The batch's own union and links are gone; everything else is as it was.
    const keep = <T extends { id: string }>(a: T[], b2: T[]) =>
      a.filter((x) => b2.some((y) => y.id === x.id));
    expect(after.p).toEqual(before.p);
    expect(after.u).toEqual(keep(before.u, after.u));
    expect(after.l).toEqual(keep(before.l, after.l));
    const rows = await db.select().from(auditLog).where(eq(auditLog.treeId, treeId));
    expect(rows.filter((r) => r.action === 'invite.revoke')).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(p.kim.id);
  });

  it('leaves no audit row anywhere naming an erased person', async () => {
    const { owner, treeId, S, p } = await setup();
    const joiner = await userWith2fa(app, 'Joiner');
    const inv = await call(app, 'POST', `${base(treeId)}/invites`, {
      jar: owner.jar,
      body: { role: 'viewer', targetPersonId: p.kim.id, stewardAnchorPersonId: p.kim.id },
    });
    expect(inv.statusCode, inv.body).toBe(201);
    const acc = await call(app, 'POST', '/api/v1/invites/accept', {
      jar: joiner.jar,
      body: { token: inv.json().token },
    });
    expect(acc.statusCode, acc.body).toBe(200);
    await call(app, 'POST', `${base(treeId)}/stewards`, {
      jar: owner.jar,
      body: { userId: S.userId, anchorPersonId: p.kim.id },
    });
    const b = await delPerson(owner.jar, treeId, p.kim.id);
    expect((await call(app, 'DELETE', trash(treeId, b), { jar: owner.jar })).statusCode).toBe(204);
    const all = await db.select().from(auditLog);
    expect(JSON.stringify(all.filter((r) => r.treeId === treeId))).not.toContain(p.kim.id);
  });
});

describe('Trash erase and photos', () => {
  async function personWithPhoto(a: ReturnType<typeof buildApp>) {
    const { owner, treeId } = await ownerWithTree(a);
    const person = await addPerson(db, treeId, 'Pic');
    const photo = await addPhotoRow(db, treeId, person.id);
    const keys = [photo.storageKeyFull, photo.storageKeyThumb];
    for (const k of keys) await deps.storage.put(k, new Uint8Array([1, 2, 3]), 'image/webp');
    const batch = await softDeleteBatch(db, treeId, owner.userId, [person.id]);
    return { owner, treeId, person, photo, keys, batch };
  }
  const queued = (keys: string[]) =>
    db.select().from(storageDeletions).where(inArray(storageDeletions.key, keys));

  it('erase frees the photo objects', async () => {
    const t = await personWithPhoto(app);
    expect(await db.select().from(photos).where(eq(photos.id, t.photo.id))).toHaveLength(1);
    const res = await call(app, 'DELETE', `/api/v1/trees/${t.treeId}/trash/${t.batch.id}`, {
      jar: t.owner.jar,
    });
    expect(res.statusCode).toBe(204);
    expect(await db.select().from(photos).where(eq(photos.id, t.photo.id))).toHaveLength(0);
    for (const k of t.keys) expect(await objectExists(deps, k)).toBe(false);
    expect(await queued(t.keys)).toHaveLength(0);
  });

  it('restore brings the photos back', async () => {
    const t = await personWithPhoto(app);
    const restore = await call(
      app,
      'POST',
      `/api/v1/trees/${t.treeId}/trash/${t.batch.id}/restore`,
      {
        jar: t.owner.jar,
      },
    );
    expect(restore.statusCode).toBe(204);
    const view = await call(app, 'GET', `/api/v1/trees/${t.treeId}/persons/${t.person.id}`, {
      jar: t.owner.jar,
    });
    expect(view.json().photos.map((p: { id: string }) => p.id)).toEqual([t.photo.id]);
  });

  it('still answers 204 when storage is down, and keeps the keys queued', async () => {
    const down = {
      ...deps.storage,
      delete: () => Promise.reject(new Error('down')),
    };
    const brokenApp = buildApp({ config, checks: deps.checks, auth, db, storage: down });
    try {
      const t = await personWithPhoto(brokenApp);
      const res = await call(brokenApp, 'DELETE', `/api/v1/trees/${t.treeId}/trash/${t.batch.id}`, {
        jar: t.owner.jar,
      });
      expect(res.statusCode).toBe(204);
      expect(await db.select().from(photos).where(eq(photos.id, t.photo.id))).toHaveLength(0);
      const rows = await queued(t.keys);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.attempts === 1)).toBe(true);
      const { drainStorageDeletions } = await import('../storage/deletions.js');
      await drainStorageDeletions(db, deps.storage, { keys: t.keys });
      expect(await queued(t.keys)).toHaveLength(0);
      for (const k of t.keys) expect(await objectExists(deps, k)).toBe(false);
    } finally {
      await brokenApp.close();
    }
  });
});
