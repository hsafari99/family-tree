import { and, eq } from 'drizzle-orm';
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
import { persons, residences } from '../db/schema.js';
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

const personUrl = (t: string, p: string) => `/api/v1/trees/${t}/persons/${p}`;
const resUrl = (t: string, r: string) => `/api/v1/trees/${t}/residences/${r}`;

describe('residences', () => {
  it('adds, edits and removes a residence with audit rows', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const p = await addPerson(db, treeId, 'Ada');
    const add = await call(app, 'POST', `${personUrl(treeId, p.id)}/residences`, {
      jar: owner.jar,
      body: { place: 'Leeds', fromDate: { qualifier: 'after', date1: '1950' } },
    });
    expect(add.statusCode).toBe(201);
    const id = add.json().id as string;
    const view = (await call(app, 'GET', personUrl(treeId, p.id), { jar: owner.jar })).json();
    expect(view.residences.map((r: { place: string }) => r.place)).toEqual(['Leeds']);

    const edit = await call(app, 'PATCH', resUrl(treeId, id), {
      jar: owner.jar,
      body: {
        place: 'York',
        fromDate: { qualifier: 'exact', date1: '1951' },
        toDate: { qualifier: 'exact', date1: '1960' },
      },
    });
    expect(edit.statusCode).toBe(204);
    const [row] = await db.select().from(residences).where(eq(residences.id, id));
    expect(row!.place).toBe('York');

    const del = await call(app, 'DELETE', resUrl(treeId, id), { jar: owner.jar });
    expect(del.statusCode).toBe(204);
    expect(await db.select().from(residences).where(eq(residences.id, id))).toHaveLength(0);

    const log = (await auditRows(db, treeId)).filter((r) => r.entityId === id);
    expect(log.map((r) => r.action)).toEqual([
      'residence.create',
      'residence.update',
      'residence.delete',
    ]);
    for (const r of log) expect(r.personIds).toEqual([p.id]);
    expect(log[2]!.before).toMatchObject({ place: 'York' });
  });

  it('404s on residences of deleted people or other trees', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const gone = await addPerson(db, treeId, 'Gone');
    const [r] = await db
      .insert(residences)
      .values({ treeId, personId: gone.id, place: 'X' })
      .returning();
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, gone.id));
    const other = await ownerWithTree(app, 'Other');
    const op = await addPerson(db, other.treeId, 'Zed');
    const [or] = await db
      .insert(residences)
      .values({ treeId: other.treeId, personId: op.id, place: 'Y' })
      .returning();
    const body = { place: 'Z' };
    for (const id of [r!.id, or!.id]) {
      expect(
        (await call(app, 'PATCH', resUrl(treeId, id), { jar: owner.jar, body })).statusCode,
      ).toBe(404);
      expect((await call(app, 'DELETE', resUrl(treeId, id), { jar: owner.jar })).statusCode).toBe(
        404,
      );
    }
    const add = await call(app, 'POST', `${personUrl(treeId, gone.id)}/residences`, {
      jar: owner.jar,
      body,
    });
    expect(add.statusCode).toBe(404);
  });

  it('caps residences at 50 per person', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const p = await addPerson(db, treeId, 'Ada');
    await db
      .insert(residences)
      .values(Array.from({ length: 50 }, (_, i) => ({ treeId, personId: p.id, place: `P${i}` })));
    const res = await call(app, 'POST', `${personUrl(treeId, p.id)}/residences`, {
      jar: owner.jar,
      body: { place: 'One more' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    const n = await db
      .select()
      .from(residences)
      .where(and(eq(residences.treeId, treeId), eq(residences.personId, p.id)));
    expect(n).toHaveLength(50);
  });

  it('limits a steward to their branch', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const robert = await addPerson(db, treeId, 'Robert');
    const mary = await addPerson(db, treeId, 'Mary');
    const dan = await addPerson(db, treeId, 'Dan');
    const george = await addPerson(db, treeId, 'George');
    const greta = await addPerson(db, treeId, 'Greta');
    await family(db, treeId, robert, mary, [dan]);
    await family(db, treeId, george, greta);
    const s = await userWith2fa(app, 'Sam');
    await addMember(db, treeId, s.userId, 'viewer', owner.userId);
    await addGrant(db, treeId, s.userId, robert.id, owner.userId);
    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    const post = (jar: typeof s.jar, id: string) =>
      call(app, 'POST', `${personUrl(treeId, id)}/residences`, { jar, body: { place: 'Hull' } });
    expect((await post(s.jar, dan.id)).statusCode).toBe(201);
    expect((await post(s.jar, george.id)).statusCode).toBe(403);
    expect((await post(viewer.jar, dan.id)).statusCode).toBe(403);
  });
});
