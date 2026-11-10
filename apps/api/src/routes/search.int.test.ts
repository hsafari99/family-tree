import {
  kinshipChain,
  kinshipTerm,
  relationshipSchema,
  searchResponseSchema,
} from '@family-tree/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import { addPhotoRow } from '../../test/photo-helpers.js';
import { addMember, addPerson, ownerWithTree } from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { persons } from '../db/schema.js';
import { seedSampleFamily } from '../db/seed.js';
import { createDeps } from '../deps.js';
import { branchPersonIds } from '../trees/branch.js';

const config = loadConfig();
const deps = createDeps(config);
const { db } = deps;
const auth = createAuth({ config, db, rateLimitEnabled: false });

let app: ReturnType<typeof buildApp>;
beforeEach(() => {
  app = buildApp({ config, checks: deps.checks, auth, db, storage: deps.storage });
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await deps.close();
});

const rootOf = async (treeId: string) =>
  (await db.query.trees.findFirst({ where: (t, { eq: e }) => e(t.id, treeId) }))!.rootPersonId!;
const s = (t: string, qs: string) => `/api/v1/trees/${t}/search?${qs}`;

/** The seed family (owner's card is Leo) plus a few extra people, and a second tree. */
async function setup() {
  const owner = await signUp(app, { name: 'Olive' });
  const { treeId } = await seedSampleFamily(db, { ownerUserId: owner.userId });
  const id = async (given: string) =>
    (
      await db
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.treeId, treeId), eq(persons.givenName, given)))
    )[0]!.id;
  await addPerson(db, treeId, 'José', { surname: 'Núñez', nickname: 'Pepe' });
  await addPerson(db, treeId, 'Robert', { surname: 'Smith' });
  await addPerson(db, treeId, '100%', { surname: 'Real' });
  return { owner, treeId, id };
}
const names = async (jar: unknown, t: string, qs: string) => {
  const res = await call(app, 'GET', s(t, qs), { jar: jar as never });
  expect(res.statusCode).toBe(200);
  return searchResponseSchema.parse(res.json()).results.map((r) => r.givenName);
};

describe('GET search', () => {
  it('tolerates typos and accents and searches every name field', async () => {
    const { owner, treeId } = await setup();
    const n = (qs: string) => names(owner.jar, treeId, qs);
    expect(await n('q=Margret')).toContain('Margaret');
    expect(await n('q=jose')).toContain('José');
    expect(await n('q=nunez')).toContain('José');
    expect(await n('q=pepe')).toContain('José');
    expect(await n('q=Ellis')).toContain('Margaret');
    const both = await n('q=hale robert');
    expect(both.indexOf('Robert')).toBe(0);
    expect(await n('q=robert hale')).toEqual(both);
    expect((await n('q=Rob')).filter((x) => x === 'Robert')).toHaveLength(2);
    expect(await n('q=zzzz')).toEqual([]);
  });

  it('ranks Hales first, then by given name', async () => {
    const { owner, treeId } = await setup();
    const res = await call(app, 'GET', s(treeId, 'q=Hale'), { jar: owner.jar });
    const rows = searchResponseSchema.parse(res.json()).results;
    const hales = rows.filter((r) => r.surname === 'Hale').map((r) => r.givenName);
    expect(rows.slice(0, hales.length).map((r) => r.givenName)).toEqual(hales);
    expect(hales).toEqual([...hales].sort());
  });

  it('filters by years, status, place and branch', async () => {
    const { owner, treeId, id } = await setup();
    const n = async (qs: string) => (await names(owner.jar, treeId, qs)).sort();
    expect(await n('bornFrom=1950&bornTo=1965')).toEqual(['Anna', 'David', 'Laura', 'Susan']);
    expect(await n('diedFrom=2000')).toEqual(['Margaret']);
    const dead = await n('status=deceased');
    expect(dead).toEqual(expect.arrayContaining(['Robert', 'Margaret']));
    const living = await n('status=living');
    expect(living).not.toContain('Margaret');
    expect(await n('place=leeds')).toEqual(['Robert']);
    expect(await n('place=toronto')).toEqual(['Robert']);
    expect(await n('place=LEÉDS')).toEqual(['Robert']);
    expect(await n('place=100%')).toEqual([]);
    expect(await n('q=Hale&status=living&bornFrom=1980')).toEqual(['Emma', 'Leo', 'Mia', 'Noah']);
    const susan = await id('Susan');
    const branch = await branchPersonIds(db, treeId, susan, null);
    const got = await call(app, 'GET', s(treeId, `branch=${susan}&limit=50`), { jar: owner.jar });
    expect(
      searchResponseSchema
        .parse(got.json())
        .results.map((r) => r.id)
        .sort(),
    ).toEqual([...branch].sort());
    expect(branch).toContain(await id('Noah'));
  });

  it('never returns deleted people or other trees', async () => {
    const { owner, treeId } = await setup();
    const b = await ownerWithTree(app);
    await addPerson(db, b.treeId, 'Margareta');
    const gone = await addPerson(db, treeId, 'Margaretta');
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, gone.id));
    expect(await names(owner.jar, treeId, 'q=Margaretta')).not.toContain('Margaretta');
    expect(await names(owner.jar, treeId, 'q=Margareta')).not.toContain('Margareta');
  });

  it('validates the query and caps the limit', async () => {
    const { owner, treeId, id } = await setup();
    const code = async (qs: string) =>
      (await call(app, 'GET', s(treeId, qs), { jar: owner.jar })).statusCode;
    expect(await code('')).toBe(400);
    expect(await code('bornFrom=1990&bornTo=1980')).toBe(400);
    expect(await code('q=a&limit=51')).toBe(400);
    expect(await code('q=a&branch=nope')).toBe(400);
    expect(await names(owner.jar, treeId, 'q=Hale&limit=2')).toHaveLength(2);
    expect(await code(`branch=${await id('Leo')}`)).toBe(200);
    // truncates, never rejects, past five words
    expect(await code('q=a b c d e f g h')).toBe(200);
  });

  it('answers 404 for another tree’s branch person and for outsiders', async () => {
    const { owner, treeId } = await setup();
    const other = await ownerWithTree(app);
    const bRoot = await rootOf(other.treeId);
    const res = await call(app, 'GET', s(treeId, `q=x&branch=${bRoot}`), { jar: owner.jar });
    expect(res.statusCode).toBe(404);
    expect((await call(app, 'GET', s(treeId, 'q=x'), { jar: other.owner.jar })).statusCode).toBe(
      404,
    );
  });

  it('gives the relation to the member’s own card', async () => {
    const { owner, treeId } = await setup();
    const res = await call(app, 'GET', s(treeId, 'q=Hale&limit=50'), { jar: owner.jar });
    const rows = searchResponseSchema.parse(res.json()).results;
    const of = (n: string) => rows.find((r) => r.givenName === n)!;
    expect(kinshipTerm(of('David').relation!)).toBe('father');
    expect(kinshipTerm(of('Noah').relation!)).toBe('first cousin');
    expect(of('Leo').relation).toEqual([]);
    const lone = await addPerson(db, treeId, 'Lonely', { surname: 'Hale' });
    const again = await call(app, 'GET', s(treeId, 'q=Lonely'), { jar: owner.jar });
    expect(searchResponseSchema.parse(again.json()).results[0]!.relation).toBeNull();
    void lone;
    // a member without a card
    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    const v = await call(app, 'GET', s(treeId, 'q=Hale'), { jar: viewer.jar });
    expect(v.statusCode).toBe(200);
    for (const r of searchResponseSchema.parse(v.json()).results) expect(r.relation).toBeNull();
  });

  it('signs the primary thumbnail only', async () => {
    const { owner, treeId, id } = await setup();
    const ph = await addPhotoRow(db, treeId, await id('Margaret'), true);
    const res = await call(app, 'GET', s(treeId, 'q=Hale&limit=50'), { jar: owner.jar });
    for (const r of searchResponseSchema.parse(res.json()).results) {
      if (r.givenName === 'Margaret') expect(r.photoThumbUrl).toContain(ph.storageKeyThumb);
      else expect(r.photoThumbUrl).toBeNull();
    }
  });

  it('serves the name condition from the trigram index', async () => {
    await setup();
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      await tx.execute(sql`select set_config('pg_trgm.word_similarity_threshold', '0.4', true)`);
      return tx.execute(sql`explain select id from persons where 'margret' <% search_name`);
    });
    expect(JSON.stringify(plan)).toContain('persons_search_name_trgm_idx');
  });

  it('rate limits per user at 120 a minute', async () => {
    const { owner, treeId } = await setup();
    let last = 0;
    for (let i = 0; i < 121; i++) {
      last = (await call(app, 'GET', s(treeId, 'q=hale'), { jar: owner.jar })).statusCode;
      if (i < 120) expect(last).toBe(200);
    }
    expect(last).toBe(429);
  });
});

describe('GET relationship', () => {
  const rel = (t: string, a: string, b: string) =>
    `/api/v1/trees/${t}/relationship?from=${a}&to=${b}`;

  it('words paths between people', async () => {
    const { owner, treeId, id } = await setup();
    const get = async (a: string, b: string) => {
      const res = await call(app, 'GET', rel(treeId, await id(a), await id(b)), { jar: owner.jar });
      expect(res.statusCode).toBe(200);
      return relationshipSchema.parse(res.json());
    };
    const lau = await get('Leo', 'Laura');
    expect(lau.steps).toMatchObject([{ move: 'parent', personId: await id('Laura') }]);
    expect(lau.persons.map((p) => p.givenName)).toEqual(['Leo', 'Laura']);
    const nl = await get('Noah', 'Laura');
    expect(kinshipTerm(nl.steps!)).toBe('aunt by marriage');
    expect(kinshipChain(nl.steps!, 'Noah’s')).toBe('Noah’s mother’s brother’s wife');
    expect(kinshipTerm((await get('Leo', 'Emma')).steps!)).toBe('half-sister');
    expect(kinshipTerm((await get('Leo', 'Mia')).steps!)).toBe('sister');
    const same = await get('Leo', 'Leo');
    expect(same.steps).toEqual([]);
    const lone = await addPerson(db, treeId, 'Lonely');
    const none = await call(app, 'GET', rel(treeId, await id('Leo'), lone.id), { jar: owner.jar });
    const body = relationshipSchema.parse(none.json());
    expect(body.steps).toBeNull();
    expect(body.persons).toHaveLength(1);
  });

  it('404s for deleted or foreign people, 400s for malformed ids, 200 for viewers', async () => {
    const { owner, treeId, id } = await setup();
    const leo = await id('Leo');
    const gone = await addPerson(db, treeId, 'Gone');
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, gone.id));
    expect((await call(app, 'GET', rel(treeId, leo, gone.id), { jar: owner.jar })).statusCode).toBe(
      404,
    );
    const other = await ownerWithTree(app);
    const bRoot = await rootOf(other.treeId);
    expect((await call(app, 'GET', rel(treeId, leo, bRoot), { jar: owner.jar })).statusCode).toBe(
      404,
    );
    expect((await call(app, 'GET', rel(treeId, 'nope', leo), { jar: owner.jar })).statusCode).toBe(
      400,
    );
    const viewer = await signUp(app, { name: 'Vera' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    expect(
      (await call(app, 'GET', rel(treeId, leo, await id('David')), { jar: viewer.jar })).statusCode,
    ).toBe(200);
  });
});

describe('duplicate check on trigrams', () => {
  const sim = (t: string, qs: string) => `/api/v1/trees/${t}/persons/similar?${qs}`;

  it('matches accents and nicknames', async () => {
    const { owner, treeId } = await setup();
    const find = async (qs: string) =>
      (await call(app, 'GET', sim(treeId, qs), { jar: owner.jar }))
        .json()
        .persons.map((p: { givenName: string }) => p.givenName) as string[];
    expect(await find('givenName=Jose&surname=Nunez')).toContain('José');
    expect(await find('givenName=Pepe')).toContain('José');
  });

  it('does not let the 200-candidate cap drop the best match among 300 Annas', async () => {
    const { owner, treeId } = await setup();
    const ids = Array.from({ length: 300 }, () => crypto.randomUUID()).sort();
    await db.insert(persons).values(
      ids.map((pid, i) => ({
        id: pid,
        treeId,
        givenName: 'Anna',
        surname: i === 299 ? 'Price' : `Other${i}`,
        birthSortYear: i === 299 ? 1960 : 1900 + (i % 20),
        birthDate:
          i === 299
            ? { qualifier: 'exact' as const, date1: '1960' }
            : { qualifier: 'exact' as const, date1: String(1900 + (i % 20)) },
      })),
    );
    const res = await call(app, 'GET', sim(treeId, 'givenName=Anna&surname=Price&birthYear=1960'), {
      jar: owner.jar,
    });
    const list = res.json().persons as { id: string; surname: string }[];
    expect(list.length).toBeLessThanOrEqual(5);
    // The seed's own Anna Price is a second true match; the 300th Anna must not be cut off.
    expect(list.slice(0, 2).map((p) => p.id)).toContain(ids[299]);
  });

  it('matches words under 3 characters as prefixes only', async () => {
    const { owner, treeId } = await setup();
    await addPerson(db, treeId, 'Hannah', { surname: 'Zed' });
    await addPerson(db, treeId, 'Anya', { surname: 'Zed' });
    await addPerson(db, treeId, 'Mary', { surname: 'Ann' });
    const found = await names(owner.jar, treeId, 'q=an');
    expect(found).toEqual(expect.arrayContaining(['Anna', 'Anya', 'Mary']));
    expect(found).not.toContain('Hannah');
    expect(found).not.toContain('Susan');
    // Three letters and more still match inside a word.
    expect(await names(owner.jar, treeId, 'q=nna')).toContain('Hannah');
  });
});
