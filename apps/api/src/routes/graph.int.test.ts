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
import { persons } from '../db/schema.js';
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
    const sb = parse(
      (await call(app, 'GET', g(treeId, 'mode=full'), { jar: steward.jar })).json(),
    );
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
    const { eq } = await import('drizzle-orm');
    await db.update(persons).set({ siblingOrder: 2 }).where(eq(persons.id, p.olive!.id));
    await db.update(persons).set({ siblingOrder: 1 }).where(eq(persons.id, p.sis!.id));
    const body = parse((await call(app, 'GET', g(treeId), { jar: owner.jar })).json());
    const order = (n: string) => body.persons.find((x) => x.givenName === n)!.siblingOrder;
    expect([order('Olive'), order('Sis')]).toEqual([2, 1]);
  });
});
