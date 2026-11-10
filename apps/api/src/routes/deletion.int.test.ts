import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import {
  addGrant,
  addMember,
  addPerson,
  auditRows,
  family,
  ownerWithTree,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { deletionBatches, parentChild, persons, trees, unions } from '../db/schema.js';
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

/**
 * Robert + Mary -> Dan; Dan + Ann -> Leo; George + Greta -> Ann; Dan + (none) -> Kim; Leo + Zoe.
 * S is a viewer steward of Robert's branch; E is an editor.
 */
async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const [t] = await db.select().from(trees).where(eq(trees.id, treeId));
  const root = t!.rootPersonId!;
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
    root,
    S,
    E,
    danAnn,
    danKim,
    leoZoe,
    p: { robert: robert!, dan: dan!, ann: ann!, leo: leo!, george: george!, kim: kim!, zoe: zoe! },
  };
}

const base = (t: string) => `/api/v1/trees/${t}`;
const preview = (t: string, id: string) => `${base(t)}/persons/${id}/delete-preview`;
const del = (t: string, id: string) => `${base(t)}/persons/${id}/delete`;

describe('delete preview and delete', () => {
  it('previews and deletes one person into a batch', async () => {
    const { owner, treeId, danAnn, danKim, p } = await setup();
    const pv = await call(app, 'POST', preview(treeId, p.dan.id), {
      jar: owner.jar,
      body: { mode: 'person' },
    });
    expect(pv.statusCode).toBe(200);
    const body = pv.json();
    expect(body.people.map((x: { id: string }) => x.id)).toEqual([p.dan.id]);
    expect(body).toMatchObject({
      unions: 2,
      links: 2,
      outsideScope: 0,
      blockedByRoot: false,
      allowed: true,
    });

    const res = await call(app, 'POST', del(treeId, p.dan.id), {
      jar: owner.jar,
      body: { mode: 'person' },
    });
    expect(res.statusCode).toBe(200);
    const batchId = res.json().batchId as string;
    const [dan] = await db.select().from(persons).where(eq(persons.id, p.dan.id));
    expect(dan!.deletedAt).not.toBeNull();
    expect(dan!.deletionBatchId).toBe(batchId);
    const [ua] = await db.select().from(unions).where(eq(unions.id, danAnn.id));
    expect(ua).toMatchObject({ deletedAt: null, partnerAId: null, partnerBId: p.ann.id });
    const [uk] = await db.select().from(unions).where(eq(unions.id, danKim.id));
    expect(uk!.deletionBatchId).toBe(batchId);
    const links = await db.select().from(parentChild).where(eq(parentChild.treeId, treeId));
    const gone = links
      .filter((l) => l.deletionBatchId === batchId)
      .map((l) => l.childId)
      .sort();
    expect(gone).toEqual([p.dan.id, p.kim.id].sort());
    const [batch] = await db.select().from(deletionBatches).where(eq(deletionBatches.id, batchId));
    expect(batch).toMatchObject({
      mode: 'person',
      rootPersonId: p.dan.id,
      slots: [{ unionId: danAnn.id, slot: 'a', personId: p.dan.id }],
    });
    const log = (await auditRows(db, treeId)).find((r) => r.action === 'person.delete')!;
    expect(log.entityId).toBe(batchId);
    expect(log.personIds).toEqual(expect.arrayContaining([p.ann.id, p.kim.id]));

    const list = await call(app, 'GET', `${base(treeId)}/persons`, { jar: owner.jar });
    expect(JSON.stringify(list.json())).not.toContain(p.dan.id);
    const av = (
      await call(app, 'GET', `${base(treeId)}/persons/${p.ann.id}`, { jar: owner.jar })
    ).json();
    expect(
      av.relations.unions[0].children.map((c: { person: { id: string } }) => c.person.id),
    ).toEqual([p.leo.id]);
  });

  it('previews descendants mode with lone partners', async () => {
    const { owner, treeId, p } = await setup();
    const pv = await call(app, 'POST', preview(treeId, p.dan.id), {
      jar: owner.jar,
      body: { mode: 'descendants' },
    });
    expect(
      pv
        .json()
        .people.map((x: { id: string }) => x.id)
        .sort(),
    ).toEqual([p.dan.id, p.leo.id, p.kim.id, p.zoe.id].sort());
  });

  it('refuses to delete the root person', async () => {
    const { owner, treeId, root } = await setup();
    const pv = await call(app, 'POST', preview(treeId, root), {
      jar: owner.jar,
      body: { mode: 'person' },
    });
    expect(pv.json()).toMatchObject({ blockedByRoot: true, allowed: false });
    const res = await call(app, 'POST', del(treeId, root), {
      jar: owner.jar,
      body: { mode: 'person' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    expect(res.json().error.details.personId).toBeDefined();
  });

  it('keeps a steward to their scope', async () => {
    const { treeId, S, p } = await setup();
    const kim = await call(app, 'POST', preview(treeId, p.kim.id), {
      jar: S.jar,
      body: { mode: 'person' },
    });
    expect(kim.json().allowed).toBe(true);
    expect(
      (await call(app, 'POST', del(treeId, p.kim.id), { jar: S.jar, body: { mode: 'person' } }))
        .statusCode,
    ).toBe(200);

    const dan = await call(app, 'POST', preview(treeId, p.dan.id), {
      jar: S.jar,
      body: { mode: 'person' },
    });
    expect(dan.statusCode).toBe(200);
    expect(dan.json().outsideScope).toBeGreaterThanOrEqual(1);
    expect(dan.json().allowed).toBe(false);
    const snap = async () => ({
      p: (
        await db
          .select({ id: persons.id, d: persons.deletedAt })
          .from(persons)
          .where(eq(persons.treeId, treeId))
      ).sort((a, b) => a.id.localeCompare(b.id)),
      u: (await db.select().from(unions).where(eq(unions.treeId, treeId))).sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    });
    const before = await snap();
    const res = await call(app, 'POST', del(treeId, p.dan.id), {
      jar: S.jar,
      body: { mode: 'person' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(await snap()).toEqual(before);
    const geo = await call(app, 'POST', preview(treeId, p.george.id), {
      jar: S.jar,
      body: { mode: 'person' },
    });
    expect(geo.statusCode).toBe(403);
  });

  it('forbids editors', async () => {
    const { treeId, E, p } = await setup();
    expect(
      (
        await call(app, 'POST', preview(treeId, p.kim.id), {
          jar: E.jar,
          body: { mode: 'person' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call(app, 'POST', del(treeId, p.kim.id), { jar: E.jar, body: { mode: 'person' } }))
        .statusCode,
    ).toBe(403);
  });

  it('deletes a union with its child links, and a single link', async () => {
    const { owner, treeId, S, leoZoe, p } = await setup();
    const g = await call(app, 'POST', `${base(treeId)}/unions/${leoZoe.id}/delete`, {
      jar: owner.jar,
    });
    expect(g.statusCode).toBe(200);
    const [u] = await db.select().from(unions).where(eq(unions.id, leoZoe.id));
    expect(u).toMatchObject({
      deletionBatchId: g.json().batchId,
      partnerAId: p.leo.id,
      partnerBId: p.zoe.id,
    });
    expect(u!.deletedAt).not.toBeNull();
    const [b] = await db
      .select()
      .from(deletionBatches)
      .where(eq(deletionBatches.id, g.json().batchId));
    expect(b).toMatchObject({ mode: 'relation', rootUnionId: leoZoe.id, rootPersonId: null });
    const [leo] = await db.select().from(persons).where(eq(persons.id, p.leo.id));
    expect(leo!.deletedAt).toBeNull();

    const geoUnion = (await db.select().from(unions).where(eq(unions.partnerAId, p.george.id)))[0]!;
    const s = await call(app, 'POST', `${base(treeId)}/unions/${geoUnion.id}/delete`, {
      jar: S.jar,
    });
    expect(s.statusCode).toBe(403);
    // Both ends must be in scope: Dan is, Ann (a partner in Dan+Ann) is not.
    const danAnn = (await db.select().from(unions).where(eq(unions.partnerBId, p.ann.id))).find(
      (x) => x.partnerAId === p.dan.id,
    )!;
    expect(
      (await call(app, 'POST', `${base(treeId)}/unions/${danAnn.id}/delete`, { jar: S.jar }))
        .statusCode,
    ).toBe(403);

    const [link] = await db.select().from(parentChild).where(eq(parentChild.childId, p.leo.id));
    const l = await call(app, 'POST', `${base(treeId)}/parent-child/${link!.id}/delete`, {
      jar: owner.jar,
    });
    expect(l.statusCode).toBe(200);
    const [bl] = await db
      .select()
      .from(deletionBatches)
      .where(eq(deletionBatches.id, l.json().batchId));
    expect(bl).toMatchObject({ mode: 'relation', rootParentChildId: link!.id });
  });

  it('404s on gone or foreign ids and 400s on a bad mode', async () => {
    const { owner, treeId, p } = await setup();
    const first = await call(app, 'POST', del(treeId, p.kim.id), {
      jar: owner.jar,
      body: { mode: 'person' },
    });
    expect(first.statusCode).toBe(200);
    expect(
      (await call(app, 'POST', del(treeId, p.kim.id), { jar: owner.jar, body: { mode: 'person' } }))
        .statusCode,
    ).toBe(404);
    const other = await setup();
    const [ou] = await db.select().from(unions).where(eq(unions.treeId, other.treeId));
    const [ol] = await db.select().from(parentChild).where(eq(parentChild.treeId, other.treeId));
    expect(
      (await call(app, 'POST', `${base(treeId)}/unions/${ou!.id}/delete`, { jar: owner.jar }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(app, 'POST', `${base(treeId)}/parent-child/${ol!.id}/delete`, { jar: owner.jar }))
        .statusCode,
    ).toBe(404);
    const bad = await call(app, 'POST', del(treeId, p.dan.id), {
      jar: owner.jar,
      body: { mode: 'everyone' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('hides the tree from non-members and forbids viewers', async () => {
    const { treeId, p } = await setup();
    const out = await signUp(app, { name: 'Out' });
    for (const [m, url] of [
      ['POST', preview(treeId, p.kim.id)],
      ['POST', del(treeId, p.kim.id)],
      ['POST', `${base(treeId)}/persons/${p.kim.id}/residences`],
      ['GET', `${base(treeId)}/persons/${p.kim.id}/history`],
    ] as const) {
      const r = await call(app, m, url, { jar: out.jar, body: { mode: 'person', place: 'X' } });
      expect(r.statusCode, url).toBe(404);
    }
    const t2 = await setup();
    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, t2.treeId, viewer.userId, 'viewer', t2.owner.userId);
    const r = await call(app, 'POST', del(t2.treeId, t2.p.kim.id), {
      jar: viewer.jar,
      body: { mode: 'person' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('deletes exactly the previewed people in descendants mode', async () => {
    const { owner, treeId, p } = await setup();
    const pv = await call(app, 'POST', preview(treeId, p.dan.id), {
      jar: owner.jar,
      body: { mode: 'descendants' },
    });
    const previewed = pv
      .json()
      .people.map((x: { id: string }) => x.id)
      .sort();
    const res = await call(app, 'POST', del(treeId, p.dan.id), {
      jar: owner.jar,
      body: { mode: 'descendants' },
    });
    expect(res.statusCode).toBe(200);
    const batchId = res.json().batchId as string;
    const inBatch = (
      await db.select({ id: persons.id }).from(persons).where(eq(persons.deletionBatchId, batchId))
    )
      .map((r) => r.id)
      .sort();
    expect(inBatch).toEqual(previewed);
    const [b] = await db.select().from(deletionBatches).where(eq(deletionBatches.id, batchId));
    expect(b).toMatchObject({ mode: 'descendants', rootPersonId: p.dan.id });
    const log = (await auditRows(db, treeId)).find((r) => r.action === 'person.delete')!;
    expect(log.after).toMatchObject({
      rootPersonId: p.dan.id,
      rootName: 'Dan',
      mode: 'descendants',
    });
  });
});
