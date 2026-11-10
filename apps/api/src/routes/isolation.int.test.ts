import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, CookieJar } from '../../test/auth-helpers.js';
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
import {
  auditLog,
  branchStewards,
  deletionBatches,
  invites,
  parentChild,
  persons,
  resetLinks,
  residences,
  treeMembers,
  trees,
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

type Ids = {
  member: string;
  grant: string;
  invite: string;
  person: string;
  person2: string;
  union: string;
  link: string;
  residence: string;
  batch: string;
};
type Route = readonly [
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: Record<string, unknown>,
];

const routes = (t: string, ids: Ids): Route[] => [
  ['GET', `/api/v1/trees/${t}`],
  ['PATCH', `/api/v1/trees/${t}`, { name: 'hijacked' }],
  ['DELETE', `/api/v1/trees/${t}`],
  ['POST', `/api/v1/trees/${t}/restore`],
  ['GET', `/api/v1/trees/${t}/persons`],
  ['GET', `/api/v1/trees/${t}/members`],
  ['PATCH', `/api/v1/trees/${t}/members/${ids.member}`, { role: 'editor' }],
  ['DELETE', `/api/v1/trees/${t}/members/${ids.member}`],
  ['POST', `/api/v1/trees/${t}/transfer`, { userId: ids.member }],
  ['POST', `/api/v1/trees/${t}/members/${ids.member}/reset-link`],
  ['GET', `/api/v1/trees/${t}/stewards`],
  ['POST', `/api/v1/trees/${t}/stewards`, { userId: ids.member, anchorPersonId: ids.person }],
  ['DELETE', `/api/v1/trees/${t}/stewards/${ids.grant}`],
  ['GET', `/api/v1/trees/${t}/invites`],
  ['POST', `/api/v1/trees/${t}/invites`, { role: 'viewer' }],
  ['DELETE', `/api/v1/trees/${t}/invites/${ids.invite}`],
  ['GET', `/api/v1/trees/${t}/persons/${ids.person}`],
  ['POST', `/api/v1/trees/${t}/persons`, { person: { givenName: 'Intruder' } }],
  ['PATCH', `/api/v1/trees/${t}/persons/${ids.person}`, { version: 1, surname: 'X' }],
  ['GET', `/api/v1/trees/${t}/persons/${ids.person}/history`],
  [
    'POST',
    `/api/v1/trees/${t}/persons/${ids.person}/relatives`,
    { personId: ids.person2, as: 'partner' },
  ],
  ['POST', `/api/v1/trees/${t}/persons/${ids.person}/residences`, { place: 'X' }],
  ['PATCH', `/api/v1/trees/${t}/residences/${ids.residence}`, { place: 'X' }],
  ['DELETE', `/api/v1/trees/${t}/residences/${ids.residence}`],
  ['PATCH', `/api/v1/trees/${t}/unions/${ids.union}`, { status: 'divorced' }],
  ['POST', `/api/v1/trees/${t}/unions/${ids.union}/delete`],
  ['PATCH', `/api/v1/trees/${t}/parent-child/${ids.link}`, { kind: 'step' }],
  ['POST', `/api/v1/trees/${t}/parent-child/${ids.link}/delete`],
  ['POST', `/api/v1/trees/${t}/persons/${ids.person}/delete-preview`, { mode: 'person' }],
  ['POST', `/api/v1/trees/${t}/persons/${ids.person}/delete`, { mode: 'person' }],
  ['GET', `/api/v1/trees/${t}/trash`],
  ['GET', `/api/v1/trees/${t}/trash/${ids.batch}`],
  ['POST', `/api/v1/trees/${t}/trash/${ids.batch}/restore`],
  ['DELETE', `/api/v1/trees/${t}/trash/${ids.batch}`],
  ['GET', `/api/v1/trees/${t}/graph`],
  ['GET', `/api/v1/trees/${t}/graph?mode=full`],
  ['GET', `/api/v1/trees/${t}/graph?focus=${ids.person}&depth=2`],
  ['GET', `/api/v1/trees/${t}/disconnected`],
  ['GET', `/api/v1/trees/${t}/persons/similar?givenName=Intruder`],
  [
    'POST',
    `/api/v1/trees/${t}/unions/${ids.union}/child-order`,
    { childIds: [ids.person, ids.person2] },
  ],
];

async function setup() {
  const { owner, treeId } = await ownerWithTree(app, 'Tree A');
  const member = await userWith2fa(app, 'Mel');
  await addMember(db, treeId, member.userId, 'viewer', owner.userId);
  const person = await addPerson(db, treeId, 'Anchor');
  const grant = await addGrant(db, treeId, member.userId, person.id, owner.userId);
  const p2 = await addPerson(db, treeId, 'Two');
  const p3 = await addPerson(db, treeId, 'Three');
  const p4 = await addPerson(db, treeId, 'Four');
  const u = await family(db, treeId, person, p2, [p3]);
  const [link] = await db.select().from(parentChild).where(eq(parentChild.unionId, u.id));
  const [res] = await db
    .insert(residences)
    .values({ treeId, personId: person.id, place: 'Leeds' })
    .returning();
  const batch = await softDeleteBatch(db, treeId, owner.userId, [p4.id]);
  const [invite] = await db
    .insert(invites)
    .values({
      tokenHash: `hash-${treeId}`,
      treeId,
      role: 'viewer',
      createdByUserId: owner.userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  const x = await userWith2fa(app, 'Xavier');
  const b = await call(app, 'POST', '/api/v1/trees', {
    jar: x.jar,
    body: { name: 'Tree B', person: { givenName: 'Xan', surname: 'Ex' } },
  });
  const treeB = b.json().tree.id as string;
  const ids: Ids = {
    member: member.userId,
    grant: grant.id,
    invite: invite!.id,
    person: person.id,
    person2: p2.id,
    union: u.id,
    link: link!.id,
    residence: res!.id,
    batch: batch.id,
  };
  return { owner, member, treeId, treeB, x, ids };
}

async function snapshot(treeId: string) {
  const [tree] = await db.select().from(trees).where(eq(trees.id, treeId));
  const members = await db.select().from(treeMembers).where(eq(treeMembers.treeId, treeId));
  const grants = await db.select().from(branchStewards).where(eq(branchStewards.treeId, treeId));
  const inv = await db.select().from(invites).where(eq(invites.treeId, treeId));
  const links = await db.select().from(resetLinks).where(eq(resetLinks.treeId, treeId));
  const by = <T extends { id: string }>(a: T[]) => a.sort((x, y) => x.id.localeCompare(y.id));
  const ps = await db.select().from(persons).where(eq(persons.treeId, treeId));
  const us = await db.select().from(unions).where(eq(unions.treeId, treeId));
  const pcs = await db.select().from(parentChild).where(eq(parentChild.treeId, treeId));
  const rs = await db.select().from(residences).where(eq(residences.treeId, treeId));
  const bs = await db.select().from(deletionBatches).where(eq(deletionBatches.treeId, treeId));
  const audits = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(eq(auditLog.treeId, treeId));
  return {
    persons: by(
      ps.map((x) => ({
        id: x.id,
        version: x.version,
        deletedAt: x.deletedAt,
        batch: x.deletionBatchId,
        surname: x.surname,
        siblingOrder: x.siblingOrder,
      })),
    ),
    unions: by(
      us.map((x) => ({
        id: x.id,
        a: x.partnerAId,
        b: x.partnerBId,
        status: x.status,
        deletedAt: x.deletedAt,
      })),
    ),
    parentChild: by(pcs.map((x) => ({ id: x.id, kind: x.kind, deletedAt: x.deletedAt }))),
    residences: by(rs.map((x) => ({ id: x.id, place: x.place }))),
    batches: by(bs.map((x) => ({ id: x.id, restoredAt: x.restoredAt }))),
    auditCount: audits.length,
    name: tree!.name,
    deletedAt: tree!.deletedAt,
    members: members
      .map((m) => ({ userId: m.userId, role: m.role, personId: m.personId }))
      .sort((x, y) => x.userId.localeCompare(y.userId)),
    grants: grants.map((g) => g.id).sort(),
    invites: inv
      .map((i) => ({ id: i.id, revokedAt: i.revokedAt, usedAt: i.usedAt }))
      .sort((x, y) => x.id.localeCompare(y.id)),
    resetLinks: links.length,
  };
}

const run = (jar: CookieJar | undefined, [method, url, body]: Route) =>
  call(app, method, url, { ...(jar ? { jar } : {}), ...(body ? { body } : {}) });

describe('cross-tree isolation', () => {
  it('returns 404 NOT_FOUND to an outsider on every route, and changes nothing', async () => {
    const { treeId, x, ids } = await setup();
    const before = await snapshot(treeId);
    for (const route of routes(treeId, ids)) {
      const res = await run(x.jar, route);
      expect(res.statusCode, `${route[0]} ${route[1]}`).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    }
    expect(await snapshot(treeId)).toEqual(before);
  });

  it('does not let tree B authority reach tree A ids', async () => {
    const { treeId, treeB, x, ids } = await setup();
    const before = await snapshot(treeId);
    const t = treeB;
    const subRoutes: Route[] = [
      ['PATCH', `/api/v1/trees/${t}/members/${ids.member}`, { role: 'editor' }],
      ['DELETE', `/api/v1/trees/${t}/members/${ids.member}`],
      ['POST', `/api/v1/trees/${t}/transfer`, { userId: ids.member }],
      ['POST', `/api/v1/trees/${t}/members/${ids.member}/reset-link`],
      ['DELETE', `/api/v1/trees/${t}/stewards/${ids.grant}`],
      ['DELETE', `/api/v1/trees/${t}/invites/${ids.invite}`],
    ];
    for (const route of subRoutes) {
      const res = await run(x.jar, route);
      expect(res.statusCode, `${route[0]} ${route[1]}`).toBe(404);
    }
    const aIds = [ids.person, ids.union, ids.link, ids.residence, ids.batch];
    const aRoutes = routes(t, ids).filter((rt) => aIds.some((id) => rt[1].includes(id)));
    expect(aRoutes.length).toBeGreaterThan(10);
    for (const route of aRoutes) {
      const res = await run(x.jar, route);
      expect(res.statusCode, `${route[0]} ${route[1]}`).toBe(404);
    }
    // Branch anchors are looked up in the tree of the URL too.
    const branch = await run(x.jar, [
      'GET',
      `/api/v1/trees/${t}/graph?mode=full&branch=${ids.person}`,
    ]);
    expect(branch.statusCode).toBe(404);
    const bRoot = (await db.select().from(trees).where(eq(trees.id, t)))[0]!.rootPersonId!;
    const attach = await run(x.jar, [
      'POST',
      `/api/v1/trees/${t}/persons`,
      { person: { givenName: 'Sneak' }, attach: { to: ids.person, as: 'child' } },
    ]);
    expect(attach.statusCode).toBe(400);
    expect(attach.json().error.code).toBe('VALIDATION');
    const rel = await run(x.jar, [
      'POST',
      `/api/v1/trees/${t}/persons/${bRoot}/relatives`,
      { personId: ids.person, as: 'partner' },
    ]);
    expect(rel.statusCode).toBe(400);
    // Tree A's member with a tree-B person: not a member of B. (With tree A's person the route
    // answers 400 first, because the person is checked before the member.)
    const bPerson = await addPerson(db, t, 'Bob');
    const notMember = await run(x.jar, [
      'POST',
      `/api/v1/trees/${t}/stewards`,
      { userId: ids.member, anchorPersonId: bPerson.id },
    ]);
    expect(notMember.statusCode).toBe(404);
    // A tree-B member with tree A's person: the person isn't in tree B.
    const bMember = await userWith2fa(app, 'Bea');
    await addMember(db, t, bMember.userId, 'viewer', x.userId);
    const mixed = await run(x.jar, [
      'POST',
      `/api/v1/trees/${t}/stewards`,
      { userId: bMember.userId, anchorPersonId: ids.person },
    ]);
    expect(mixed.statusCode).toBe(400);
    expect(mixed.json().error.code).toBe('VALIDATION');
    expect(await snapshot(treeId)).toEqual(before);
  });

  it('hides a soft-deleted tree from its former members', async () => {
    const { owner, member, treeId, ids } = await setup();
    const del = await call(app, 'DELETE', `/api/v1/trees/${treeId}`, { jar: owner.jar });
    expect(del.statusCode).toBe(204);
    const before = await snapshot(treeId);
    // The owner too: a deleted tree is gone for everyone except restore (checked last).
    for (const jar of [member.jar, owner.jar]) {
      for (const route of routes(treeId, ids).filter((r) => !r[1].endsWith('/restore'))) {
        const res = await run(jar, route);
        expect(res.statusCode, `${route[0]} ${route[1]}`).toBe(404);
        expect(res.json().error.code).toBe('NOT_FOUND');
      }
      expect(await snapshot(treeId)).toEqual(before);
    }
    const restore = await run(member.jar, ['POST', `/api/v1/trees/${treeId}/restore`]);
    expect(restore.statusCode).toBe(404);
    expect(await snapshot(treeId)).toEqual(before);
  });

  it('answers 401 when not signed in', async () => {
    const { treeId, ids } = await setup();
    for (const route of routes(treeId, ids)) {
      expect((await run(undefined, route)).statusCode, `${route[0]} ${route[1]}`).toBe(401);
    }
  });

  it('answers 404 for a malformed tree id', async () => {
    const { x } = await setup();
    expect((await run(x.jar, ['GET', '/api/v1/trees/not-a-uuid'])).statusCode).toBe(404);
  });
});
