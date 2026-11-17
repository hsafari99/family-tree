import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, type CookieJar, signUp } from '../../test/auth-helpers.js';
import { addMember, addPerson, ownerWithTree } from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { persons, treeMembers, trees } from '../db/schema.js';
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

const exact = (date1: string) => ({ qualifier: 'exact' as const, date1 });

async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const add = (givenName: string, extra: Partial<typeof persons.$inferInsert>) =>
    addPerson(db, treeId, givenName, { surname: 'Day', ...extra });
  const ann = await add('Ann', { birthDate: exact('1990-03-05') });
  await add('Ben', {
    birthDate: exact('1950-03-05'),
    isLiving: false,
    deathDate: exact('2001-07-01'),
  });
  const cat = await add('Cat', { isLiving: false, deathDate: exact('2010-03-05') });
  await add('Dan', { birthDate: { qualifier: 'exact', date1: '1990-03' } });
  await add('Eve', { birthDate: { qualifier: 'about', date1: '1990-03-05' } });
  await add('Fay', { birthDate: exact('1990-03-06') });
  return { owner, treeId, ann, cat };
}

const today = (opts: { jar: CookieJar }, day: string) =>
  call(app, 'GET', `/api/v1/home/today?day=${day}`, opts);

describe('GET /home/today', () => {
  it('lists living birthdays and deceased days of passing on the exact day only', async () => {
    const s = await setup();
    const res = await today({ jar: s.owner.jar }, '03-05');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      birthdays: [
        {
          treeId: s.treeId,
          personId: s.ann.id,
          name: 'Ann Day',
          givenName: 'Ann',
          surname: 'Day',
          photoThumbUrl: null,
        },
      ],
      remembering: [
        {
          treeId: s.treeId,
          personId: s.cat.id,
          name: 'Cat Day',
          givenName: 'Cat',
          surname: 'Day',
          photoThumbUrl: null,
        },
      ],
    });
  });

  it('leaves out people hidden from the caller and trees they left or that were deleted', async () => {
    const s = await setup();
    const viewer = await signUp(app, { name: 'Vee' });
    await addMember(db, s.treeId, viewer.userId, 'viewer', s.owner.userId);
    const annUser = await signUp(app, { name: 'Ann' });
    await addMember(db, s.treeId, annUser.userId, 'viewer', s.owner.userId);
    await db
      .update(treeMembers)
      .set({ personId: s.ann.id })
      .where(and(eq(treeMembers.treeId, s.treeId), eq(treeMembers.userId, annUser.userId)));
    await db.update(persons).set({ privacyLevel: 'private' }).where(eq(persons.id, s.ann.id));

    const seen = (await today({ jar: viewer.jar }, '03-05')).json();
    expect(seen.birthdays).toEqual([]);
    expect(seen.remembering).toHaveLength(1);
    // The owner always sees everyone (privacy spec D7).
    expect((await today({ jar: s.owner.jar }, '03-05')).json().birthdays).toHaveLength(1);

    await db.update(trees).set({ deletedAt: new Date() }).where(eq(trees.id, s.treeId));
    expect((await today({ jar: s.owner.jar }, '03-05')).json()).toEqual({
      birthdays: [],
      remembering: [],
    });
  });

  it('refuses a malformed day and a signed-out caller', async () => {
    const s = await setup();
    expect((await today({ jar: s.owner.jar }, '2024-03-05')).statusCode).toBe(400);
    expect((await today({ jar: s.owner.jar }, '13-01')).statusCode).toBe(400);
    expect((await call(app, 'GET', '/api/v1/home/today?day=03-05')).statusCode).toBe(401);
  });
});
