import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, type CookieJar, signUp } from '../../test/auth-helpers.js';
import { addMember, addPerson, family, ownerWithTree } from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { persons, residences, treeMembers, unions } from '../db/schema.js';
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

const born = { qualifier: 'exact' as const, date1: '1961-03-05' };

/**
 * Vic + Wendy; Wendy and Bob are children of Wf + Wm; Bob + Bea; Bea and Ben are children of
 * Bf + Bm. Ben is 4 steps from Vic (spec D5). Ben's member account sets the privacy.
 */
async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const p: Record<string, { id: string }> = {};
  for (const n of ['Vic', 'Wendy', 'Wf', 'Wm', 'Bob', 'Bea', 'Bf', 'Bm', 'Ben', 'Loner']) {
    p[n] = await addPerson(
      db,
      treeId,
      n,
      n === 'Ben' ? { birthDate: born, birthSortYear: 1961 } : {},
    );
  }
  await family(db, treeId, p.Vic!, p.Wendy!);
  await family(db, treeId, p.Wf!, p.Wm!, [p.Wendy!, p.Bob!]);
  const bobBea = await family(db, treeId, p.Bob!, p.Bea!);
  await db
    .update(unions)
    .set({ startDate: { qualifier: 'exact', date1: '1990' } })
    .where(eq(unions.id, bobBea.id));
  await family(db, treeId, p.Bf!, p.Bm!, [p.Bea!, p.Ben!]);
  await db.insert(residences).values({ treeId, personId: p.Ben!.id, place: 'Leeds' });

  const member = async (name: string, role: 'editor' | 'viewer', personId: string | null) => {
    const u = await signUp(app, { name });
    await addMember(db, treeId, u.userId, role, owner.userId);
    if (personId) {
      await db
        .update(treeMembers)
        .set({ personId })
        .where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, u.userId)));
    }
    return u.jar;
  };
  const jars = {
    owner: owner.jar,
    ben: await member('Ben', 'viewer', p.Ben!.id),
    vic: await member('Vic', 'viewer', p.Vic!.id),
    bob: await member('Bob', 'viewer', p.Bob!.id),
    loose: await member('Loose', 'viewer', null),
    editor: await member('Edie', 'editor', null),
  };
  return { treeId, p, jars, T: `/api/v1/trees/${treeId}` };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const setPrivacy = (c: Ctx, body: Record<string, unknown>, jar: CookieJar = c.jars.ben) =>
  call(app, 'PUT', `${c.T}/me/privacy`, { jar, body });
const view = async (c: Ctx, jar: CookieJar, id = c.p.Ben!.id) => {
  const res = await call(app, 'GET', `${c.T}/persons/${id}`, { jar });
  expect(res.statusCode).toBe(200);
  return res.json();
};

describe('privacy settings', () => {
  it('are read and written by the linked member only', async () => {
    const c = await setup();
    const get = await call(app, 'GET', `${c.T}/me/privacy`, { jar: c.jars.ben });
    expect(get.json()).toEqual({
      personId: c.p.Ben!.id,
      settings: { level: 'public', steps: null, hideBirthYear: false },
    });
    expect(
      (await setPrivacy(c, { level: 'branch', steps: 3, hideBirthYear: true })).statusCode,
    ).toBe(204);
    const after = await call(app, 'GET', `${c.T}/me/privacy`, { jar: c.jars.ben });
    expect(after.json().settings).toEqual({ level: 'branch', steps: 3, hideBirthYear: true });

    const unlinked = await setPrivacy(
      c,
      { level: 'private', steps: null, hideBirthYear: false },
      c.jars.loose,
    );
    expect(unlinked.statusCode).toBe(409);
    expect(unlinked.json().error.code).toBe('NOT_LINKED');
    const bad = await setPrivacy(c, { level: 'branch', steps: null, hideBirthYear: false });
    expect(bad.statusCode).toBe(400);
  });
});

describe('private', () => {
  it('shows only the names to viewers, everything to owner, editor and self', async () => {
    const c = await setup();
    await setPrivacy(c, { level: 'private', steps: null, hideBirthYear: false });

    const hidden = await view(c, c.jars.vic);
    expect(hidden.person).toMatchObject({
      givenName: 'Ben',
      restricted: true,
      birthDate: null,
      sex: 'unknown',
    });
    expect(hidden.residences).toEqual([]);
    expect(hidden.photos).toEqual([]);

    for (const jar of [c.jars.owner, c.jars.editor, c.jars.ben]) {
      const v = await view(c, jar);
      expect(v.person.restricted).toBeUndefined();
      expect(v.person.birthDate).toEqual(born);
      expect(v.residences).toHaveLength(1);
    }

    const graph = await call(app, 'GET', `${c.T}/graph?mode=full`, { jar: c.jars.vic });
    const ben = graph.json().persons.find((x: { id: string }) => x.id === c.p.Ben!.id);
    expect(ben).toMatchObject({ givenName: 'Ben', birthYear: null, restricted: true });

    const history = await call(app, 'GET', `${c.T}/persons/${c.p.Ben!.id}/history`, {
      jar: c.jars.vic,
    });
    expect(history.json()).toEqual({ entries: [] });
  });

  it('hides a union’s dates when either partner is hidden (R4)', async () => {
    const c = await setup();
    await setPrivacy(c, { level: 'private', steps: null, hideBirthYear: false }, c.jars.bob);
    const v = await view(c, c.jars.vic, c.p.Bea!.id);
    expect(v.relations.unions[0]).toMatchObject({ startDate: null, endDate: null });
    const owner = await view(c, c.jars.owner, c.p.Bea!.id);
    expect(owner.relations.unions[0].startDate).toEqual({ qualifier: 'exact', date1: '1990' });
  });

  it('counts only while a member is linked to the person (D3)', async () => {
    const c = await setup();
    await db.update(persons).set({ privacyLevel: 'private' }).where(eq(persons.id, c.p.Loner!.id));
    expect((await view(c, c.jars.vic, c.p.Loner!.id)).person.restricted).toBeUndefined();
  });
});

describe('branch', () => {
  it('reaches members within the step count (D5) and never an unlinked one (D6)', async () => {
    const c = await setup();
    await setPrivacy(c, { level: 'branch', steps: 4, hideBirthYear: false });
    expect((await view(c, c.jars.vic)).person.restricted).toBeUndefined();
    expect((await view(c, c.jars.loose)).person.restricted).toBe(true);

    await setPrivacy(c, { level: 'branch', steps: 3, hideBirthYear: false });
    expect((await view(c, c.jars.vic)).person.restricted).toBe(true);
    // Bob is 2 steps away (sister-in-law's brother... Bob + Bea, Bea's brother Ben).
    expect((await view(c, c.jars.bob)).person.restricted).toBeUndefined();
  });
});

describe('hidden birth year (D8)', () => {
  it('keeps the day and month and drops the year everywhere', async () => {
    const c = await setup();
    await setPrivacy(c, { level: 'public', steps: null, hideBirthYear: true });
    const v = await view(c, c.jars.vic);
    expect(v.person.birthDate).toBeNull();
    expect(v.person.birthday).toEqual({ month: 3, day: 5 });
    expect((await view(c, c.jars.editor)).person.birthDate).toEqual(born);

    const graph = await call(app, 'GET', `${c.T}/graph?mode=full`, { jar: c.jars.vic });
    const ben = graph.json().persons.find((x: { id: string }) => x.id === c.p.Ben!.id);
    expect(ben.birthYear).toBeNull();

    // R5: a year filter can't find the hidden year.
    const byYear = await call(app, 'GET', `${c.T}/search?bornFrom=1960&bornTo=1962`, {
      jar: c.jars.vic,
    });
    expect(byYear.json().results).toEqual([]);
    const byYearOwner = await call(app, 'GET', `${c.T}/search?bornFrom=1960&bornTo=1962`, {
      jar: c.jars.owner,
    });
    expect(byYearOwner.json().results.map((r: { id: string }) => r.id)).toEqual([c.p.Ben!.id]);
  });
});

describe('search (R5)', () => {
  it('finds a private person by name, never by a filter on hidden data', async () => {
    const c = await setup();
    await setPrivacy(c, { level: 'private', steps: null, hideBirthYear: false });
    const byName = await call(app, 'GET', `${c.T}/search?q=Ben`, { jar: c.jars.vic });
    expect(byName.json().results[0]).toMatchObject({
      id: c.p.Ben!.id,
      restricted: true,
      birthYear: null,
      photoThumbUrl: null,
    });
    const byPlace = await call(app, 'GET', `${c.T}/search?place=Leeds`, { jar: c.jars.vic });
    expect(byPlace.json().results).toEqual([]);
    const living = await call(app, 'GET', `${c.T}/search?q=Ben&status=living`, { jar: c.jars.vic });
    // Bea is not hidden, so only Ben drops out.
    expect(living.json().results.map((r: { givenName: string }) => r.givenName)).not.toContain(
      'Ben',
    );
  });
});
