import type { PersonView } from '@family-tree/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signUp, type CookieJar } from '../../test/auth-helpers.js';
import { addMember, auditRows, ownerWithTree } from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { auditLog, parentChild, trees, unions } from '../db/schema.js';
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

const newPerson = async (jar: CookieJar, treeId: string, givenName: string, attach?: object) => {
  const res = await call(app, 'POST', `/api/v1/trees/${treeId}/persons`, {
    jar,
    body: { person: { givenName }, ...(attach ? { attach } : {}) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
};
const view = async (jar: CookieJar, treeId: string, id: string) =>
  (await call(app, 'GET', `/api/v1/trees/${treeId}/persons/${id}`, { jar })).json() as PersonView;
const relatives = (treeId: string, id: string) => `/api/v1/trees/${treeId}/persons/${id}/relatives`;

async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const [t] = await db.select().from(trees).where(eq(trees.id, treeId));
  return { owner, treeId, root: t!.rootPersonId! };
}

describe('adding relatives', () => {
  it('adds a partner with defaults or given union values', async () => {
    const { owner, treeId, root } = await setup();
    await newPerson(owner.jar, treeId, 'Pat', { to: root, as: 'partner' });
    const v = await view(owner.jar, treeId, root);
    expect(v.relations.unions[0]!.partner!.givenName).toBe('Pat');
    const [u] = await db.select().from(unions).where(eq(unions.treeId, treeId));
    expect(u).toMatchObject({ type: 'marriage', status: 'married' });

    const other = await setup();
    await newPerson(other.owner.jar, other.treeId, 'Sam', {
      to: other.root,
      as: 'partner',
      union: { type: 'partnership', status: 'partners' },
    });
    const [u2] = await db.select().from(unions).where(eq(unions.treeId, other.treeId));
    expect(u2).toMatchObject({ type: 'partnership', status: 'partners' });
  });

  it('adds children into a chosen union, or the single-parent union', async () => {
    const { owner, treeId, root } = await setup();
    await newPerson(owner.jar, treeId, 'Pat', { to: root, as: 'partner' });
    const unionId = (await view(owner.jar, treeId, root)).relations.unions[0]!.id;
    const kid = await newPerson(owner.jar, treeId, 'Kid', { to: root, as: 'child', unionId });
    const rv = await view(owner.jar, treeId, root);
    expect(rv.relations.unions[0]!.children.map((c) => c.person.givenName)).toEqual(['Kid']);
    const kv = await view(owner.jar, treeId, kid);
    expect(kv.relations.parents[0]!.parents.map((p) => p.givenName).sort()).toEqual([
      'Olive',
      'Pat',
    ]);
    expect(kv.relations.parents[0]!.kind).toBe('biological');

    // Without a union: both land in one single-parent union.
    const solo = await setup();
    await newPerson(solo.owner.jar, solo.treeId, 'A', { to: solo.root, as: 'child' });
    await newPerson(solo.owner.jar, solo.treeId, 'B', { to: solo.root, as: 'child' });
    const us = await db.select().from(unions).where(eq(unions.treeId, solo.treeId));
    expect(us).toHaveLength(1);
    const sv = await view(solo.owner.jar, solo.treeId, solo.root);
    expect(sv.relations.unions[0]!.children).toHaveLength(2);
  });

  it('makes two added parents one couple, then a third a new union', async () => {
    const { owner, treeId } = await setup();
    const kid = await newPerson(owner.jar, treeId, 'Kid2');
    await newPerson(owner.jar, treeId, 'Mum', { to: kid, as: 'parent' });
    await newPerson(owner.jar, treeId, 'Dad', { to: kid, as: 'parent' });
    let v = await view(owner.jar, treeId, kid);
    expect(v.relations.parents).toHaveLength(1);
    expect(v.relations.parents[0]!.parents).toHaveLength(2);
    await newPerson(owner.jar, treeId, 'Third', { to: kid, as: 'parent' });
    v = await view(owner.jar, treeId, kid);
    expect(v.relations.parents).toHaveLength(2);
  });

  it('adds siblings', async () => {
    const { owner, treeId, root } = await setup();
    const orphan = await newPerson(owner.jar, treeId, 'Orphan');
    const noParent = await call(app, 'POST', `/api/v1/trees/${treeId}/persons`, {
      jar: owner.jar,
      body: { person: { givenName: 'Sib' }, attach: { to: orphan, as: 'sibling' } },
    });
    expect(noParent.statusCode).toBe(400);

    const kid = await newPerson(owner.jar, treeId, 'Kid', { to: root, as: 'child' });
    await newPerson(owner.jar, treeId, 'Sib', { to: kid, as: 'sibling' });
    expect(
      (await view(owner.jar, treeId, kid)).relations.siblings.map((s) => s.person.givenName),
    ).toEqual(['Sib']);

    const kid2 = await newPerson(owner.jar, treeId, 'Kid2');
    await newPerson(owner.jar, treeId, 'Mum', { to: kid2, as: 'parent' });
    await newPerson(owner.jar, treeId, 'Third', { to: kid2, as: 'parent' });
    // Make kid2 have two parent unions: Mum+? full union can't take another, so add a 2nd parent union.
    await newPerson(owner.jar, treeId, 'Fourth', { to: kid2, as: 'parent' });
    const v = await view(owner.jar, treeId, kid2);
    expect(v.relations.parents).toHaveLength(2);
    const body = { person: { givenName: 'Sib2' } };
    const amb = await call(app, 'POST', `/api/v1/trees/${treeId}/persons`, {
      jar: owner.jar,
      body: { ...body, attach: { to: kid2, as: 'sibling' } },
    });
    expect(amb.statusCode).toBe(400);
    const ok = await call(app, 'POST', `/api/v1/trees/${treeId}/persons`, {
      jar: owner.jar,
      body: {
        ...body,
        attach: { to: kid2, as: 'sibling', unionId: v.relations.parents[0]!.union.id },
      },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('links existing people and rejects cycles, duplicates and bad ids', async () => {
    const { owner, treeId, root } = await setup();
    const kid = await newPerson(owner.jar, treeId, 'Kid');
    const post = (id: string, body: Record<string, unknown>) =>
      call(app, 'POST', relatives(treeId, id), { jar: owner.jar, body });
    expect((await post(root, { as: 'child', personId: kid })).statusCode).toBe(204);
    const dup = await post(root, { as: 'child', personId: kid });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CONFLICT');
    expect((await post(root, { as: 'parent', personId: kid })).statusCode).toBe(400);
    expect((await post(root, { as: 'child', personId: root })).statusCode).toBe(400);
    const other = await setup();
    expect((await post(root, { as: 'child', personId: other.root })).statusCode).toBe(400);
    expect(
      (await post('00000000-0000-4000-8000-000000000000', { as: 'child', personId: kid }))
        .statusCode,
    ).toBe(404);
  });

  it('rejects a second live union of the same pair', async () => {
    const { owner, treeId, root } = await setup();
    const pat = await newPerson(owner.jar, treeId, 'Pat', { to: root, as: 'partner' });
    const res = await call(app, 'POST', relatives(treeId, root), {
      jar: owner.jar,
      body: { as: 'partner', personId: pat },
    });
    expect(res.statusCode).toBe(409);
  });

  it('audits new unions and links with every person concerned', async () => {
    const { owner, treeId, root } = await setup();
    const pat = await newPerson(owner.jar, treeId, 'Pat', { to: root, as: 'partner' });
    const unionId = (await view(owner.jar, treeId, root)).relations.unions[0]!.id;
    const kid = await newPerson(owner.jar, treeId, 'Kid', { to: root, as: 'child', unionId });
    const rows = await auditRows(db, treeId);
    const un = rows.find((r) => r.action === 'union.create')!;
    expect([...un.personIds].sort()).toEqual([root, pat].sort());
    const lk = rows.find((r) => r.action === 'link.create')!;
    expect([...lk.personIds].sort()).toEqual([root, pat, kid].sort());
  });
});

describe('editing unions and links', () => {
  async function withFamily() {
    const s = await setup();
    await newPerson(s.owner.jar, s.treeId, 'Pat', { to: s.root, as: 'partner' });
    const unionId = (await view(s.owner.jar, s.treeId, s.root)).relations.unions[0]!.id;
    const kid = await newPerson(s.owner.jar, s.treeId, 'Kid', { to: s.root, as: 'child', unionId });
    const linkId = (await view(s.owner.jar, s.treeId, kid)).relations.parents[0]!.linkId;
    return { ...s, unionId, kid, linkId };
  }

  it('edits a union and audits only the changed fields', async () => {
    const { owner, treeId, unionId } = await withFamily();
    const res = await call(app, 'PATCH', `/api/v1/trees/${treeId}/unions/${unionId}`, {
      jar: owner.jar,
      body: { status: 'divorced', endDate: { qualifier: 'exact', date1: '2001' } },
    });
    expect(res.statusCode).toBe(204);
    const [u] = await db.select().from(unions).where(eq(unions.id, unionId));
    expect(u).toMatchObject({ status: 'divorced', endDate: { qualifier: 'exact', date1: '2001' } });
    const log = (await auditRows(db, treeId)).filter((r) => r.action === 'union.update');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      before: { status: 'married', endDate: null },
      after: { status: 'divorced', endDate: { qualifier: 'exact', date1: '2001' } },
    });
  });

  it('rejects an end before the start', async () => {
    const { owner, treeId, unionId } = await withFamily();
    const url = `/api/v1/trees/${treeId}/unions/${unionId}`;
    await call(app, 'PATCH', url, {
      jar: owner.jar,
      body: { startDate: { qualifier: 'exact', date1: '1970' } },
    });
    const res = await call(app, 'PATCH', url, {
      jar: owner.jar,
      body: { endDate: { qualifier: 'exact', date1: '1960' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.endDate).toBeDefined();
  });

  it('edits a link kind', async () => {
    const { owner, treeId, linkId } = await withFamily();
    const res = await call(app, 'PATCH', `/api/v1/trees/${treeId}/parent-child/${linkId}`, {
      jar: owner.jar,
      body: { kind: 'adoptive' },
    });
    expect(res.statusCode).toBe(204);
    const [l] = await db.select().from(parentChild).where(eq(parentChild.id, linkId));
    expect(l!.kind).toBe('adoptive');
    const log = (await auditRows(db, treeId)).filter((r) => r.action === 'link.update');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ before: { kind: 'biological' }, after: { kind: 'adoptive' } });
  });

  it('404s on foreign or soft-deleted unions and links, writing no audit row', async () => {
    const { owner, treeId, unionId, linkId } = await withFamily();
    const other = await withFamily();
    const count = async () =>
      (
        await db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.treeId, treeId)))
      ).length;
    const before = await count();
    const p = (path: string, body: Record<string, unknown>) =>
      call(app, 'PATCH', `/api/v1/trees/${treeId}/${path}`, { jar: owner.jar, body });
    expect((await p(`unions/${other.unionId}`, { status: 'divorced' })).statusCode).toBe(404);
    expect((await p(`parent-child/${other.linkId}`, { kind: 'step' })).statusCode).toBe(404);
    await db.update(parentChild).set({ deletedAt: new Date() }).where(eq(parentChild.id, linkId));
    await db.update(unions).set({ deletedAt: new Date() }).where(eq(unions.id, unionId));
    expect((await p(`unions/${unionId}`, { status: 'divorced' })).statusCode).toBe(404);
    expect((await p(`parent-child/${linkId}`, { kind: 'step' })).statusCode).toBe(404);
    expect(await count()).toBe(before);
  });

  it('forbids viewers from every write', async () => {
    const { owner, treeId, root, unionId, linkId, kid } = await withFamily();
    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    const jar = viewer.jar;
    const base = `/api/v1/trees/${treeId}`;
    const rs = await Promise.all([
      call(app, 'POST', relatives(treeId, root), { jar, body: { as: 'child', personId: kid } }),
      call(app, 'PATCH', `${base}/unions/${unionId}`, { jar, body: { status: 'divorced' } }),
      call(app, 'PATCH', `${base}/parent-child/${linkId}`, { jar, body: { kind: 'step' } }),
    ]);
    expect(rs.map((r) => r.statusCode)).toEqual([403, 403, 403]);
  });
});
