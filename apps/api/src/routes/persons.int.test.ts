import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call } from '../../test/auth-helpers.js';
import {
  addGrant,
  addMember,
  addPerson,
  auditRows,
  family,
  ownerWithTree,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { signUp } from '../../test/auth-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { auditLog, persons } from '../db/schema.js';
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

const url = (t: string, p = '') => `/api/v1/trees/${t}/persons${p ? `/${p}` : ''}`;

async function rootOf(treeId: string) {
  const res = await db.query.trees.findFirst({ where: (t, { eq: e }) => e(t.id, treeId) });
  return res!.rootPersonId!;
}

describe('person routes', () => {
  it('creates, reads and edits a person with versions and audit rows', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const created = await call(app, 'POST', url(treeId), {
      jar: owner.jar,
      body: {
        person: {
          givenName: 'Ada',
          surname: 'King',
          birthDate: { qualifier: 'about', date1: '1815' },
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const [row] = await db.select().from(persons).where(eq(persons.id, id));
    expect(row).toMatchObject({
      createdBy: owner.userId,
      updatedBy: owner.userId,
      birthSortYear: 1815,
      version: 1,
    });

    const view = await call(app, 'GET', url(treeId, id), { jar: owner.jar });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({
      person: {
        id,
        givenName: 'Ada',
        surname: 'King',
        version: 1,
        createdByName: 'Owner',
        isLiving: true,
      },
      residences: [],
      relations: { parents: [], unions: [], siblings: [] },
      capabilities: { edit: true, addRelative: true, delete: true },
    });

    const edit = await call(app, 'PATCH', url(treeId, id), {
      jar: owner.jar,
      body: {
        version: 1,
        surname: 'Lovelace',
        birthDate: { qualifier: 'exact', date1: '1815-12-10' },
      },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toEqual({ version: 2 });
    const stale = await call(app, 'PATCH', url(treeId, id), {
      jar: owner.jar,
      body: { version: 1, surname: 'Byron' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONFLICT');
    const [after] = await db.select().from(persons).where(eq(persons.id, id));
    expect(after).toMatchObject({ surname: 'Lovelace', version: 2 });

    const log = (await auditRows(db, treeId)).filter((r) => r.entityId === id);
    expect(log.map((r) => r.action)).toEqual(['person.create', 'person.update']);
    expect(log[1]).toMatchObject({
      userId: owner.userId,
      personIds: [id],
      before: { surname: 'King', birthDate: { qualifier: 'about', date1: '1815' } },
      after: { surname: 'Lovelace', birthDate: { qualifier: 'exact', date1: '1815-12-10' } },
    });
  });

  it('treats an unchanged update as a no-op', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const id = await rootOf(treeId);
    const before = (await auditRows(db, treeId)).length;
    const res = await call(app, 'PATCH', url(treeId, id), {
      jar: owner.jar,
      body: { version: 1, surname: 'Owner' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 1 });
    expect((await auditRows(db, treeId)).length).toBe(before);
  });

  it('rejects living with a death date, and bad input', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const created = await call(app, 'POST', url(treeId), {
      jar: owner.jar,
      body: {
        person: {
          givenName: 'Old',
          deathDate: { qualifier: 'exact', date1: '1900' },
          isLiving: false,
        },
      },
    });
    const id = created.json().id as string;
    const res = await call(app, 'PATCH', url(treeId, id), {
      jar: owner.jar,
      body: { version: 1, isLiving: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    expect(res.json().error.details.isLiving).toBeDefined();
    const empty = await call(app, 'POST', url(treeId), {
      jar: owner.jar,
      body: { person: { givenName: '' } },
    });
    expect(empty.statusCode).toBe(400);
    const sex = await call(app, 'POST', url(treeId), {
      jar: owner.jar,
      body: { person: { givenName: 'X', sex: 'robot' } },
    });
    expect(sex.statusCode).toBe(400);
  });

  it('404s on unknown, foreign and soft-deleted people', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const other = await ownerWithTree(app, 'Other');
    const foreign = await rootOf(other.treeId);
    const gone = await addPerson(db, treeId, 'Gone', { deletedAt: new Date() });
    const ids = ['00000000-0000-4000-8000-000000000000', foreign, gone.id];
    for (const id of ids) {
      expect((await call(app, 'GET', url(treeId, id), { jar: owner.jar })).statusCode).toBe(404);
      const res = await call(app, 'PATCH', url(treeId, id), {
        jar: owner.jar,
        body: { version: 1, surname: 'Z' },
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('attaches a new person as a child of the root', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const root = await rootOf(treeId);
    const created = await call(app, 'POST', url(treeId), {
      jar: owner.jar,
      body: { person: { givenName: 'Kid' }, attach: { to: root, as: 'child' } },
    });
    expect(created.statusCode).toBe(201);
    const view = (await call(app, 'GET', url(treeId, root), { jar: owner.jar })).json();
    expect(view.relations.unions).toHaveLength(1);
    expect(view.relations.unions[0].partner).toBeNull();
    expect(view.relations.unions[0].children[0].person.givenName).toBe('Kid');
  });

  it('lets viewers read but not write', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    const root = await rootOf(treeId);
    const post = await call(app, 'POST', url(treeId), {
      jar: viewer.jar,
      body: { person: { givenName: 'Nope' } },
    });
    expect(post.statusCode).toBe(403);
    expect(post.json().error.code).toBe('FORBIDDEN');
    const patch = await call(app, 'PATCH', url(treeId, root), {
      jar: viewer.jar,
      body: { version: 1, surname: 'Nope' },
    });
    expect(patch.statusCode).toBe(403);
    const get = await call(app, 'GET', url(treeId, root), { jar: viewer.jar });
    expect(get.statusCode).toBe(200);
    expect(get.json().capabilities).toEqual({ edit: false, addRelative: false, delete: false });
  });

  it('404s for a logged-in non-member on every route', async () => {
    const { treeId } = await ownerWithTree(app);
    const root = await rootOf(treeId);
    const outsider = await signUp(app, { name: 'Out' });
    const jar = outsider.jar;
    const rs = await Promise.all([
      call(app, 'GET', url(treeId, root), { jar }),
      call(app, 'PATCH', url(treeId, root), { jar, body: { version: 1, surname: 'X' } }),
      call(app, 'POST', url(treeId), { jar, body: { person: { givenName: 'X' } } }),
    ]);
    expect(rs.map((r) => r.statusCode)).toEqual([404, 404, 404]);
  });

  it('keeps the generic 4xx shape for unsupported media types outside the upload route', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const res = await call(app, 'POST', url(treeId), {
      jar: owner.jar,
      headers: { 'content-type': 'image/gif' },
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('BAD_REQUEST');
    expect(res.json().error.details).toBeUndefined();
  });

  it('limits a steward to their branch', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const dan = await addPerson(db, treeId, 'Dan');
    const george = await addPerson(db, treeId, 'George');
    await family(db, treeId, dan, null);
    const steward = await userWith2fa(app, 'Sam');
    await addMember(db, treeId, steward.userId, 'viewer', owner.userId);
    await addGrant(db, treeId, steward.userId, dan.id, owner.userId);
    const jar = steward.jar;
    const add = (to: string) =>
      call(app, 'POST', url(treeId), {
        jar,
        body: { person: { givenName: 'Kid' }, attach: { to, as: 'child' } },
      });
    expect((await add(dan.id)).statusCode).toBe(201);
    expect((await add(george.id)).statusCode).toBe(403);
    const patch = (id: string) =>
      call(app, 'PATCH', url(treeId, id), { jar, body: { version: 1, surname: 'Z' } });
    expect((await patch(dan.id)).statusCode).toBe(200);
    expect((await patch(george.id)).statusCode).toBe(403);
  });
});

describe('person history', () => {
  it('lists changes to the person, newest first, without leaking member rows', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const created = await call(app, 'POST', url(treeId), {
      jar: owner.jar,
      body: { person: { givenName: 'Ada', surname: 'King' } },
    });
    const id = created.json().id as string;
    const other = await addPerson(db, treeId, 'Other');
    await call(app, 'PATCH', url(treeId, id), {
      jar: owner.jar,
      body: { version: 1, middleName: 'A' },
    });
    await call(app, 'PATCH', url(treeId, id), {
      jar: owner.jar,
      body: { version: 2, surname: 'Lovelace' },
    });
    await call(app, 'PATCH', url(treeId, other.id), {
      jar: owner.jar,
      body: { version: 1, surname: 'Q' },
    });
    await call(app, 'POST', `${url(treeId, id)}/relatives`, {
      jar: owner.jar,
      body: { as: 'partner', personId: other.id },
    });
    await call(app, 'POST', `${url(treeId, id)}/residences`, {
      jar: owner.jar,
      body: { place: 'Leeds' },
    });
    // Rows that must never reach a viewer, even with person_ids set.
    await db.insert(auditLog).values({
      treeId,
      userId: owner.userId,
      action: 'invite.create',
      entityType: 'invite',
      entityId: null,
      personIds: [id],
    });
    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);

    for (const jar of [owner.jar, viewer.jar]) {
      const res = await call(app, 'GET', `${url(treeId, id)}/history`, { jar });
      expect(res.statusCode).toBe(200);
      const entries = res.json().entries as {
        action: string;
        by: string;
        changes: unknown[];
      }[];
      expect(entries.map((e) => e.action)).toEqual([
        'residence.create',
        'union.create',
        'person.update',
        'person.update',
        'person.create',
      ]);
      expect(entries.every((e) => e.by === 'Owner')).toBe(true);
      expect(entries[2]!.changes).toEqual([
        { field: 'surname', before: 'King', after: 'Lovelace' },
      ]);
      expect(entries[0]!.changes).toEqual([]);
    }
  });

  it('lists children and siblings in sibling order', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const olive = { id: await rootOf(treeId) };
    const [pa, ma, sis, ann] = await Promise.all(
      ['Pa', 'Ma', 'Sis', 'Ann'].map((n) => addPerson(db, treeId, n)),
    );
    const u = await family(db, treeId, pa!, ma!, [olive, sis!, ann!]);
    const res = await call(app, 'POST', `/api/v1/trees/${treeId}/unions/${u.id}/child-order`, {
      jar: owner.jar,
      body: { childIds: [sis!.id, ann!.id, olive.id] },
    });
    expect(res.statusCode).toBe(204);
    const paView = await call(app, 'GET', url(treeId, pa!.id), { jar: owner.jar });
    const kids = paView.json().relations.unions[0].children as { person: { givenName: string } }[];
    expect(kids.map((k) => k.person.givenName)).toEqual(['Sis', 'Ann', 'Olive']);
    const oliveView = await call(app, 'GET', url(treeId, olive.id), { jar: owner.jar });
    const sibs = oliveView.json().relations.siblings as { person: { givenName: string } }[];
    expect(sibs.map((k) => k.person.givenName)).toEqual(['Sis', 'Ann']);
  });
});
