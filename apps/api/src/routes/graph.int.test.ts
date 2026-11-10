import { treeGraphSchema } from '@family-tree/shared';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import {
  addGrant,
  addMember,
  addPerson,
  family,
  ownerWithTree,
  softDeleteBatch,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { eq } from 'drizzle-orm';
import { auditLog, parentChild, persons, unions } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { addPhotoRow } from '../../test/photo-helpers.js';

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

/** The Task 3 fixture, around the tree's root "Olive". */
async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const root = await db.query.trees.findFirst({ where: (t, { eq: e }) => e(t.id, treeId) });
  const olive = { id: root!.rootPersonId! };
  const [gp, gm, pa, ma, sis, step, half, sam, kid, kp, gk, lone] = await Promise.all(
    ['Gp', 'Gm', 'Pa', 'Ma', 'Sis', 'Step', 'Half', 'Sam', 'Kid', 'Kp', 'Gk', 'Lone'].map((n) =>
      addPerson(db, treeId, n),
    ),
  );
  await family(db, treeId, gp!, gm!, [pa!]);
  const uPa = await family(db, treeId, pa!, ma!, [olive, sis!]);
  await family(db, treeId, ma!, step!, [half!]);
  const uOlive = await family(db, treeId, olive, sam!, [kid!]);
  await family(db, treeId, kid!, kp!, [gk!]);
  const p = { olive, gp, gm, pa, ma, sis, step, half, sam, kid, kp, gk, lone } as Record<
    string,
    { id: string }
  >;
  return { owner, treeId, p, uPa, uOlive };
}
const g = (t: string, qs = '') => `/api/v1/trees/${t}/graph${qs ? `?${qs}` : ''}`;
const parse = (body: unknown) => treeGraphSchema.parse(body);
const namesOf = (body: unknown) =>
  parse(body)
    .persons.map((x) => x.givenName)
    .sort();

describe('GET graph', () => {
  it('defaults to a depth-1 focus on the root', async () => {
    const { owner, treeId, p, uPa, uOlive } = await setup();
    const res = await call(app, 'GET', g(treeId), { jar: owner.jar });
    expect(res.statusCode).toBe(200);
    const body = parse(res.json());
    expect(namesOf(body)).toEqual(['Kid', 'Ma', 'Olive', 'Pa', 'Sam', 'Sis']);
    expect(body).toMatchObject({
      mode: 'focus',
      focusId: p.olive!.id,
      truncated: false,
      needsBranch: false,
      total: 13,
    });
    expect(body.unions.map((u) => u.id).sort()).toEqual([uPa.id, uOlive.id].sort());
    expect(body.links).toHaveLength(3);
    const hidden = body.persons.filter((x) => x.hiddenRelatives).map((x) => x.givenName);
    expect(hidden.sort()).toEqual(['Kid', 'Ma', 'Pa']);
  });

  it('depth 2 adds the next ring and never the lone person', async () => {
    const { owner, treeId, p } = await setup();
    const res = await call(app, 'GET', g(treeId, `focus=${p.olive!.id}&depth=2`), {
      jar: owner.jar,
    });
    expect(namesOf(res.json())).toEqual(
      ['Gk', 'Gm', 'Gp', 'Half', 'Kid', 'Kp', 'Ma', 'Olive', 'Pa', 'Sam', 'Sis', 'Step'].sort(),
    );
  });

  it('full view returns everyone; a branch view returns the branch', async () => {
    const { owner, treeId, p } = await setup();
    const full = await call(app, 'GET', g(treeId, 'mode=full'), { jar: owner.jar });
    expect(parse(full.json()).persons).toHaveLength(13);
    const branch = await call(app, 'GET', g(treeId, `mode=full&branch=${p.sam!.id}`), {
      jar: owner.jar,
    });
    expect(namesOf(branch.json())).toEqual(['Gk', 'Kid', 'Kp', 'Sam']);
    expect(parse(branch.json()).branchId).toBe(p.sam!.id);
  });

  it('rejects bad queries with 400 VALIDATION', async () => {
    const { owner, treeId } = await setup();
    for (const qs of ['depth=4', 'depth=0', 'mode=all', 'focus=nope']) {
      const res = await call(app, 'GET', g(treeId, qs), { jar: owner.jar });
      expect(res.statusCode, qs).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    }
  });

  it('404s for people that are not live in this tree', async () => {
    const { owner, treeId, p } = await setup();
    const other = await ownerWithTree(app, 'Other');
    const otherRoot = await db.query.trees.findFirst({
      where: (t, { eq: e }) => e(t.id, other.treeId),
    });
    await softDeleteBatch(db, treeId, owner.userId, [p.lone!.id]);
    for (const qs of [
      `focus=${crypto.randomUUID()}`,
      `focus=${otherRoot!.rootPersonId}`,
      `mode=full&branch=${p.lone!.id}`,
    ]) {
      const res = await call(app, 'GET', g(treeId, qs), { jar: owner.jar });
      expect(res.statusCode, qs).toBe(404);
    }
  });

  it('leaves out deleted people and their links', async () => {
    const { owner, treeId, p } = await setup();
    await softDeleteBatch(db, treeId, owner.userId, [p.sis!.id]);
    const body = parse((await call(app, 'GET', g(treeId), { jar: owner.jar })).json());
    expect(body.persons.map((x) => x.givenName)).not.toContain('Sis');
    expect(body.links).toHaveLength(2);
  });

  it('computes the can() flags per role', async () => {
    const { owner, treeId, p, uPa, uOlive } = await setup();
    const ownerBody = parse(
      (await call(app, 'GET', g(treeId, 'mode=full'), { jar: owner.jar })).json(),
    );
    expect(ownerBody.persons.every((x) => x.canAddRelative)).toBe(true);
    expect(ownerBody.unions.every((u) => u.canEdit)).toBe(true);

    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    const vres = await call(app, 'GET', g(treeId, 'mode=full'), { jar: viewer.jar });
    expect(vres.statusCode).toBe(200);
    const vb = parse(vres.json());
    expect(vb.persons.some((x) => x.canAddRelative)).toBe(false);
    expect(vb.unions.some((u) => u.canEdit)).toBe(false);

    const steward = await userWith2fa(app, 'Sam Steward');
    await addMember(db, treeId, steward.userId, 'viewer', owner.userId);
    await addGrant(db, treeId, steward.userId, p.sam!.id, owner.userId);
    const sb = parse((await call(app, 'GET', g(treeId, 'mode=full'), { jar: steward.jar })).json());
    const add = (n: string) => sb.persons.find((x) => x.givenName === n)!.canAddRelative;
    expect(['Sam', 'Kid', 'Kp', 'Gk'].map(add)).toEqual([true, true, true, true]);
    expect(['Olive', 'Pa'].map(add)).toEqual([false, false]);
    const edit = (id: string) => sb.unions.find((u) => u.id === id)!.canEdit;
    expect(edit(uOlive.id)).toBe(true);
    expect(edit(uPa.id)).toBe(false);
  });

  it('asks for a branch above 2,000 people', async () => {
    const { owner, treeId, p } = await setup();
    await db
      .insert(persons)
      .values(Array.from({ length: 2000 }, (_, i) => ({ treeId, givenName: `Bulk ${i}` })));
    const full = parse((await call(app, 'GET', g(treeId, 'mode=full'), { jar: owner.jar })).json());
    expect(full).toMatchObject({ needsBranch: true, persons: [], total: 2013 });
    const branch = await call(app, 'GET', g(treeId, `mode=full&branch=${p.sam!.id}`), {
      jar: owner.jar,
    });
    expect(branch.statusCode).toBe(200);
    expect(parse(branch.json()).persons).toHaveLength(4);
    const focus = parse((await call(app, 'GET', g(treeId), { jar: owner.jar })).json());
    expect(focus.persons).toHaveLength(6);
  });

  it('404s for outsiders and 401s without a session', async () => {
    const { treeId } = await setup();
    const stranger = await signUp(app, { name: 'Stranger' });
    expect((await call(app, 'GET', g(treeId), { jar: stranger.jar })).statusCode).toBe(404);
    expect((await call(app, 'GET', g(treeId))).statusCode).toBe(401);
  });

  it('carries sibling order', async () => {
    const { owner, treeId, p } = await setup();
    await db.update(persons).set({ siblingOrder: 2 }).where(eq(persons.id, p.olive!.id));
    await db.update(persons).set({ siblingOrder: 1 }).where(eq(persons.id, p.sis!.id));
    const body = parse((await call(app, 'GET', g(treeId), { jar: owner.jar })).json());
    const order = (n: string) => body.persons.find((x) => x.givenName === n)!.siblingOrder;
    expect([order('Olive'), order('Sis')]).toEqual([2, 1]);
  });
});

describe('GET disconnected', () => {
  const d = (t: string) => `/api/v1/trees/${t}/disconnected`;
  it('lists people not reachable from the root, as summaries', async () => {
    const { owner, treeId } = await setup();
    const res = await call(app, 'GET', d(treeId), { jar: owner.jar });
    expect(res.statusCode).toBe(200);
    const list = res.json().persons as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ givenName: 'Lone' });
    expect(Object.keys(list[0]!).sort()).toEqual(
      ['birthYear', 'deathYear', 'givenName', 'id', 'isLiving', 'middleName', 'surname'].sort(),
    );
  });
  it('is empty once Lone is linked', async () => {
    const { owner, treeId, p } = await setup();
    await family(db, treeId, p.sam!, p.lone!);
    const res = await call(app, 'GET', d(treeId), { jar: owner.jar });
    expect(res.json().persons).toEqual([]);
  });
  it('soft-deleting Pa disconnects Gp and Gm but not Ma', async () => {
    const { owner, treeId, p } = await setup();
    await softDeleteBatch(db, treeId, owner.userId, [p.pa!.id]);
    const res = await call(app, 'GET', d(treeId), { jar: owner.jar });
    expect((res.json().persons as { givenName: string }[]).map((x) => x.givenName)).toEqual([
      'Gm',
      'Gp',
      'Lone',
    ]);
  });
  it('lets a viewer read it and hides it from outsiders', async () => {
    const { owner, treeId } = await setup();
    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    expect((await call(app, 'GET', d(treeId), { jar: viewer.jar })).statusCode).toBe(200);
    const stranger = await signUp(app, { name: 'Stranger' });
    expect((await call(app, 'GET', d(treeId), { jar: stranger.jar })).statusCode).toBe(404);
  });
});

describe('GET persons/similar', () => {
  const s = (t: string, qs: string) => `/api/v1/trees/${t}/persons/similar?${qs}`;
  async function people() {
    const ctx = await setup();
    const { treeId } = ctx;
    const yr = (y: number) => ({ birthSortYear: y });
    await addPerson(db, treeId, 'Ada', { surname: 'Lovelace', ...yr(1815) });
    await addPerson(db, treeId, 'Adah', { surname: 'Lovelace', ...yr(1816) });
    await addPerson(db, treeId, 'Ada', { surname: 'Lovelace', ...yr(1840) });
    await addPerson(db, treeId, 'Zoë', { surname: 'Ångström' });
    await addPerson(db, treeId, 'Ada', { surname: 'King', maidenName: 'Lovelace', ...yr(1815) });
    return ctx;
  }
  it('ranks exact matches first and drops far birth years', async () => {
    const { owner, treeId } = await people();
    const res = await call(app, 'GET', s(treeId, 'givenName=Ada&surname=Lovelace&birthYear=1815'), {
      jar: owner.jar,
    });
    expect(res.statusCode).toBe(200);
    const got = (
      res.json().persons as { givenName: string; surname: string; birthYear: number }[]
    ).map((x) => `${x.givenName} ${x.surname} ${x.birthYear}`);
    expect(got).toEqual(['Ada King 1815', 'Ada Lovelace 1815', 'Adah Lovelace 1816']);
  });
  it('ignores accents and case', async () => {
    const { owner, treeId } = await people();
    const res = await call(app, 'GET', s(treeId, 'givenName=zoe&surname=angstrom'), {
      jar: owner.jar,
    });
    expect(res.json().persons).toHaveLength(1);
  });
  it('rejects bad queries', async () => {
    const { owner, treeId } = await people();
    for (const qs of ['givenName=', 'surname=x', 'givenName=Ada&birthYear=abc']) {
      expect((await call(app, 'GET', s(treeId, qs), { jar: owner.jar })).statusCode, qs).toBe(400);
    }
  });
  it('lets a viewer read it, hides it from outsiders, and does not shadow /persons/:id', async () => {
    const { owner, treeId, p } = await people();
    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    expect(
      (await call(app, 'GET', s(treeId, 'givenName=Ada'), { jar: viewer.jar })).statusCode,
    ).toBe(200);
    const stranger = await signUp(app, { name: 'Stranger' });
    expect(
      (await call(app, 'GET', s(treeId, 'givenName=Ada'), { jar: stranger.jar })).statusCode,
    ).toBe(404);
    const one = await call(app, 'GET', `/api/v1/trees/${treeId}/persons/${p.sam!.id}`, {
      jar: owner.jar,
    });
    expect(one.statusCode).toBe(200);
  });
});

describe('POST child-order', () => {
  const co = (t: string, u: string) => `/api/v1/trees/${t}/unions/${u}/child-order`;
  const order = async (ids: string[]) => {
    const rows = await db.select().from(persons);
    return ids.map((id) => rows.find((r) => r.id === id)!.siblingOrder);
  };

  it('reorders as the owner: sibling_order, no version bump, one audit row', async () => {
    const { owner, treeId, p, uPa } = await setup();
    const before = await db.select().from(persons).where(eq(persons.id, p.olive!.id));
    const res = await call(app, 'POST', co(treeId, uPa.id), {
      jar: owner.jar,
      body: { childIds: [p.sis!.id, p.olive!.id] },
    });
    expect(res.statusCode).toBe(204);
    expect(await order([p.sis!.id, p.olive!.id])).toEqual([1, 2]);
    const after = await db.select().from(persons).where(eq(persons.id, p.olive!.id));
    expect(after[0]!.version).toBe(before[0]!.version);
    const rows = (await db.select().from(auditLog).where(eq(auditLog.treeId, treeId))).filter(
      (r) => r.action === 'link.reorder',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'union',
      entityId: uPa.id,
      after: { childIds: [p.sis!.id, p.olive!.id] },
    });
    expect(rows[0]!.personIds).toEqual(
      expect.arrayContaining([p.pa!.id, p.ma!.id, p.olive!.id, p.sis!.id]),
    );
    expect((rows[0]!.before as { childIds: string[] }).childIds).toHaveLength(2);
    const hist = await call(app, 'GET', `/api/v1/trees/${treeId}/persons/${p.pa!.id}/history`, {
      jar: owner.jar,
    });
    expect(JSON.stringify(hist.json())).toContain('link.reorder');
    const graph = parse((await call(app, 'GET', g(treeId), { jar: owner.jar })).json());
    const so = (n: string) => graph.persons.find((x) => x.givenName === n)!.siblingOrder;
    expect([so('Sis'), so('Olive')]).toEqual([1, 2]);
  });

  it('rejects the wrong set of children', async () => {
    const { owner, treeId, p, uPa } = await setup();
    const post = (childIds: string[]) =>
      call(app, 'POST', co(treeId, uPa.id), { jar: owner.jar, body: { childIds } });
    expect((await post([p.sis!.id, p.gk!.id])).statusCode).toBe(409);
    expect((await post([p.sis!.id])).statusCode).toBe(400);
    expect((await post([p.sis!.id, p.sis!.id])).statusCode).toBe(400);
    expect(await order([p.sis!.id, p.olive!.id])).toEqual([null, null]);
  });

  it("404s for another tree's union and a deleted union", async () => {
    const { owner, treeId, p, uPa } = await setup();
    const other = await setup();
    const body = { childIds: [p.sis!.id, p.olive!.id] };
    expect(
      (await call(app, 'POST', co(treeId, other.uPa.id), { jar: owner.jar, body })).statusCode,
    ).toBe(404);
    await db.update(unions).set({ deletedAt: new Date() }).where(eq(unions.id, uPa.id));
    expect((await call(app, 'POST', co(treeId, uPa.id), { jar: owner.jar, body })).statusCode).toBe(
      404,
    );
  });

  it("enforces roles, including every child being in a steward's scope", async () => {
    const { owner, treeId, p, uPa, uOlive } = await setup();
    const ann = await addPerson(db, treeId, 'Ann');
    await db.insert(parentChild).values({ treeId, unionId: uOlive.id, childId: ann.id });
    const [x, y1, y2] = await Promise.all(['X', 'Y1', 'Y2'].map((n) => addPerson(db, treeId, n)));
    const uKp = await family(db, treeId, p.kp!, x!, [y1!, y2!]);

    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    const editor = await signUp(app, { name: 'Edie' });
    await addMember(db, treeId, editor.userId, 'editor', owner.userId);
    const steward = await userWith2fa(app, 'Sam Steward');
    await addMember(db, treeId, steward.userId, 'viewer', owner.userId);
    await addGrant(db, treeId, steward.userId, p.sam!.id, owner.userId);
    const stranger = await signUp(app, { name: 'Stranger' });

    const go = (jar: typeof owner.jar, u: string, ids: string[]) =>
      call(app, 'POST', co(treeId, u), { jar, body: { childIds: ids } });
    const paIds = [p.sis!.id, p.olive!.id];
    expect((await go(viewer.jar, uPa.id, paIds)).statusCode).toBe(403);
    expect((await go(steward.jar, uOlive.id, [ann.id, p.kid!.id])).statusCode).toBe(204);
    expect((await go(steward.jar, uPa.id, paIds)).statusCode).toBe(403);
    const kpIds = [y2!.id, y1!.id];
    expect((await go(steward.jar, uKp.id, kpIds)).statusCode).toBe(403);
    expect(await order(kpIds)).toEqual([null, null]);
    expect((await go(owner.jar, uKp.id, kpIds)).statusCode).toBe(204);
    expect((await go(editor.jar, uKp.id, [y1!.id, y2!.id])).statusCode).toBe(204);
    expect((await go(stranger.jar, uPa.id, paIds)).statusCode).toBe(404);
  });
});

describe('GET graph photos', () => {
  it('signs the primary thumbnail only, identically within a window, and leaks no keys', async () => {
    const { owner, treeId, p } = await setup();
    const primary = await addPhotoRow(db, treeId, p.pa!.id, true);
    await addPhotoRow(db, treeId, p.ma!.id, false);
    const a = await call(app, 'GET', g(treeId), { jar: owner.jar });
    const body = parse(a.json());
    const byName = (n: string) => body.persons.find((x) => x.givenName === n)!;
    const url = byName('Pa').photoThumbUrl!;
    expect(url.startsWith(config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT)).toBe(true);
    expect(url).toContain(primary.storageKeyThumb);
    expect(url).toContain('X-Amz-Expires=900');
    for (const x of body.persons) if (x.givenName !== 'Pa') expect(x.photoThumbUrl).toBeNull();
    const b = parse((await call(app, 'GET', g(treeId), { jar: owner.jar })).json());
    expect(b.persons.find((x) => x.givenName === 'Pa')!.photoThumbUrl).toBe(url);
    const raw = JSON.stringify(a.json());
    expect(raw).not.toContain('storage_key');
    expect(raw).not.toContain('photoThumbKey');
    for (const path of [
      `/api/v1/trees/${treeId}/disconnected`,
      `/api/v1/trees/${treeId}/persons/similar?givenName=Pa`,
    ]) {
      const r = await call(app, 'GET', path, { jar: owner.jar });
      expect(r.statusCode).toBe(200);
      expect(JSON.stringify(r.json())).not.toContain('photoThumbKey');
    }
  });
});
