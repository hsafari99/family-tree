import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, type CookieJar, signUp } from '../../test/auth-helpers.js';
import {
  addMember,
  addPerson,
  family,
  ownerWithTree,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { auditLog, persons, treeLinks, treeMembers, trees } from '../db/schema.js';
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

type Who = { jar: CookieJar; userId: string };
const get = (who: Who, url: string) => call(app, 'GET', url, { jar: who.jar });
const post = (who: Who, url: string, body = {}) => call(app, 'POST', url, { jar: who.jar, body });

async function linkCard(treeId: string, userId: string, personId: string) {
  await db
    .update(treeMembers)
    .set({ personId })
    .where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, userId)));
}

/**
 * King family (K): owner Olive (root) + Sara, their child Kid. Vee is a viewer whose card is Kid.
 * Rahimi family (R): owned by Sara (root = her card there); her parents Dad + Mum, her brother Bro.
 * Bro and Mum have their own accounts, so their privacy counts. Sara is a viewer in K on her K card.
 */
async function setup() {
  const { owner, treeId: k } = await ownerWithTree(app, 'King family');
  const [olive] = await db.select().from(persons).where(eq(persons.treeId, k));
  const saraK = await addPerson(db, k, 'Sara', { surname: 'King' });
  const kid = await addPerson(db, k, 'Kid', { surname: 'King' });
  await family(db, k, olive!, saraK, [kid]);

  const sara = await userWith2fa(app, 'Sara');
  const created = await call(app, 'POST', '/api/v1/trees', {
    jar: sara.jar,
    body: { name: 'Rahimi family', person: { givenName: 'Sara', surname: 'Rahimi' } },
  });
  const r = created.json().tree.id as string;
  const [saraR] = await db.select().from(persons).where(eq(persons.treeId, r));
  const dad = await addPerson(db, r, 'Dad', { surname: 'Rahimi' });
  const mum = await addPerson(db, r, 'Mum', { surname: 'Rahimi' });
  const bro = await addPerson(db, r, 'Bro', { surname: 'Rahimi' });
  await family(db, r, dad, mum, [saraR!, bro]);

  await addMember(db, k, sara.userId, 'viewer', owner.userId);
  await linkCard(k, sara.userId, saraK.id);
  const vee = await signUp(app, { name: 'Vee' });
  await addMember(db, k, vee.userId, 'viewer', owner.userId);
  await linkCard(k, vee.userId, kid.id);
  for (const [name, card] of [
    ['Bro', bro],
    ['Mum', mum],
  ] as const) {
    const u = await signUp(app, { name });
    await addMember(db, r, u.userId, 'viewer', sara.userId);
    await linkCard(r, u.userId, card.id);
  }
  await db.update(persons).set({ privacyLevel: 'private' }).where(eq(persons.id, bro.id));
  await db
    .update(persons)
    .set({ privacyLevel: 'branch', privacySteps: 2 })
    .where(eq(persons.id, mum.id));
  return { owner, sara, vee, k, r, olive: olive!, saraK, saraR: saraR!, kid, dad, mum, bro };
}

type S = Awaited<ReturnType<typeof setup>>;

async function linked(s: S) {
  const res = await post(s.sara, `/api/v1/trees/${s.k}/links`, { otherTreeId: s.r });
  expect(res.statusCode).toBe(201);
  const linkId = res.json().id as string;
  expect((await post(s.owner, `/api/v1/trees/${s.k}/links/${linkId}/accept`)).statusCode).toBe(204);
  return linkId;
}

describe('tree links: lifecycle', () => {
  it('goes from a proposal to a live link once both owners accepted', async () => {
    const s = await setup();
    const res = await post(s.sara, `/api/v1/trees/${s.k}/links`, { otherTreeId: s.r });
    expect(res.statusCode).toBe(201);
    const linkId = res.json().id as string;

    // Sara owns R, so R's side is accepted already (L3). Viewers don't see a pending link.
    expect((await get(s.vee, `/api/v1/trees/${s.k}/links`)).json().links).toEqual([]);
    const pending = (await get(s.owner, `/api/v1/trees/${s.k}/links`)).json().links;
    expect(pending).toMatchObject([
      {
        id: linkId,
        status: 'pending',
        otherTree: { id: s.r, name: 'Rahimi family' },
        bridge: { name: 'Sara', personId: s.saraK.id, otherPersonId: s.saraR.id },
        otherPeopleCount: 3,
        acceptedHere: false,
        acceptedThere: true,
        canAccept: true,
      },
    ]);
    expect((await get(s.owner, '/api/v1/home/link-requests')).json().requests).toEqual([
      {
        linkId,
        treeId: s.k,
        treeName: 'King family',
        otherTreeName: 'Rahimi family',
        bridgeName: 'Sara',
        otherPeopleCount: 3,
      },
    ]);
    // Not live yet: nothing of R can be read.
    expect((await get(s.vee, `/api/v1/trees/${s.k}/links/${linkId}/graph`)).statusCode).toBe(404);
    // Only the owner accepts.
    expect((await post(s.vee, `/api/v1/trees/${s.k}/links/${linkId}/accept`)).statusCode).toBe(404);
    expect((await post(s.sara, `/api/v1/trees/${s.k}/links/${linkId}/accept`)).statusCode).toBe(
      403,
    );

    expect((await post(s.owner, `/api/v1/trees/${s.k}/links/${linkId}/accept`)).statusCode).toBe(
      204,
    );
    const live = (await get(s.vee, `/api/v1/trees/${s.k}/links`)).json().links;
    expect(live).toMatchObject([{ id: linkId, status: 'live', canEnd: false }]);
    // Seen from R too.
    const fromR = (await get(s.sara, `/api/v1/trees/${s.r}/links`)).json().links;
    expect(fromR).toMatchObject([{ id: linkId, status: 'live', otherTree: { id: s.k } }]);
    expect((await get(s.owner, '/api/v1/home/link-requests')).json().requests).toEqual([]);
    // Audited in both trees.
    const actions = await db
      .select({ treeId: auditLog.treeId, action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, linkId));
    expect(actions).toHaveLength(4);
  });

  it('refuses a second link of the same pair, and a caller without a card in both trees', async () => {
    const s = await setup();
    await linked(s);
    const again = await post(s.sara, `/api/v1/trees/${s.k}/links`, { otherTreeId: s.r });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('LINK_EXISTS');
    // The owner of K has a card in K only, and isn't a member of R: 404.
    expect(
      (await post(s.owner, `/api/v1/trees/${s.k}/links`, { otherTreeId: s.r })).statusCode,
    ).toBe(404);
    // A member of both trees without a card in one of them.
    await addMember(db, s.r, s.vee.userId, 'viewer', s.sara.userId);
    const noCard = await post(s.vee, `/api/v1/trees/${s.k}/links`, { otherTreeId: s.r });
    expect(noCard.json().error.code).toBe('NOT_LINKED');
  });

  it('lets the owner decline and the bridge cancel a pending link', async () => {
    const s = await setup();
    const first = (await post(s.sara, `/api/v1/trees/${s.k}/links`, { otherTreeId: s.r })).json()
      .id as string;
    expect((await post(s.owner, `/api/v1/trees/${s.k}/links/${first}/decline`)).statusCode).toBe(
      204,
    );
    const second = (await post(s.sara, `/api/v1/trees/${s.k}/links`, { otherTreeId: s.r })).json()
      .id as string;
    expect(
      (await call(app, 'DELETE', `/api/v1/trees/${s.k}/links/${second}`, { jar: s.sara.jar }))
        .statusCode,
    ).toBe(204);
    const rows = await db
      .select()
      .from(treeLinks)
      .where(eq(treeLinks.treeAId, [s.k, s.r].sort()[0]!));
    expect(rows.map((r) => r.endReason).sort()).toEqual(['cancelled', 'declined']);
  });

  it('lets an owner or the bridge end a live link, but not a viewer', async () => {
    const s = await setup();
    const linkId = await linked(s);
    const end = (who: Who) =>
      call(app, 'DELETE', `/api/v1/trees/${s.k}/links/${linkId}`, { jar: who.jar });
    expect((await end(s.vee)).statusCode).toBe(403);
    expect((await end(s.owner)).statusCode).toBe(204);
    expect((await get(s.vee, `/api/v1/trees/${s.k}/links`)).json().links).toEqual([]);
    expect((await get(s.vee, `/api/v1/trees/${s.k}/links/${linkId}/graph`)).statusCode).toBe(404);
  });

  it('ends by itself when the bridge leaves a tree, and stays ended', async () => {
    const s = await setup();
    const linkId = await linked(s);
    const removed = await call(app, 'DELETE', `/api/v1/trees/${s.k}/members/${s.sara.userId}`, {
      jar: s.owner.jar,
    });
    expect(removed.statusCode).toBe(204);
    const [row] = await db.select().from(treeLinks).where(eq(treeLinks.id, linkId));
    expect(row!.endReason).toBe('bridge_left');
    // Coming back doesn't revive it.
    await addMember(db, s.k, s.sara.userId, 'viewer', s.owner.userId);
    await linkCard(s.k, s.sara.userId, s.saraK.id);
    expect((await get(s.vee, `/api/v1/trees/${s.k}/links`)).json().links).toEqual([]);
  });

  it('ends when the bridge card is deleted, or the tree is deleted', async () => {
    const s = await setup();
    const linkId = await linked(s);
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, s.saraK.id));
    expect((await get(s.vee, `/api/v1/trees/${s.k}/links`)).json().links).toEqual([]);
    const [row] = await db.select().from(treeLinks).where(eq(treeLinks.id, linkId));
    expect(row!.endReason).toBe('card_unlinked');
    await db.update(persons).set({ deletedAt: null }).where(eq(persons.id, s.saraK.id));
    expect((await get(s.vee, `/api/v1/trees/${s.k}/links`)).json().links).toEqual([]);

    const again = (await post(s.sara, `/api/v1/trees/${s.k}/links`, { otherTreeId: s.r })).json()
      .id as string;
    await post(s.owner, `/api/v1/trees/${s.k}/links/${again}/accept`);
    expect(
      (await call(app, 'DELETE', `/api/v1/trees/${s.r}`, { jar: s.sara.jar })).statusCode,
    ).toBe(204);
    const [ended] = await db.select().from(treeLinks).where(eq(treeLinks.id, again));
    expect(ended!.endReason).toBe('tree_deleted');
  });

  it('lists the caller’s other trees as candidates', async () => {
    const s = await setup();
    expect((await get(s.sara, `/api/v1/trees/${s.k}/links/candidates`)).json().candidates).toEqual([
      { treeId: s.r, name: 'Rahimi family', peopleCount: 3 },
    ]);
    await linked(s);
    expect((await get(s.sara, `/api/v1/trees/${s.k}/links/candidates`)).json().candidates).toEqual(
      [],
    );
    expect((await get(s.vee, `/api/v1/trees/${s.k}/links/candidates`)).json().candidates).toEqual(
      [],
    );
  });
});

describe('tree links: what a visitor sees', () => {
  it('joins the linked tree at the bridge, with each person’s privacy (V1, V3)', async () => {
    const s = await setup();
    const linkId = await linked(s);
    const res = await get(s.vee, `/api/v1/trees/${s.k}/links/${linkId}/graph`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tree).toEqual({ id: s.r, name: 'Rahimi family' });
    expect(body.bridgePersonId).toBe(s.saraK.id);
    const people = new Map(
      (body.graph.persons as { id: string; givenName: string; restricted?: boolean }[]).map((p) => [
        p.givenName,
        p,
      ]),
    );
    // R's Sara card is not drawn: K's Sara card stands for her.
    expect([...people.keys()].sort()).toEqual(['Bro', 'Dad', 'Mum']);
    expect(body.graph.links.map((l: { childId: string }) => l.childId).sort()).toEqual(
      [s.saraK.id, s.bro.id].sort(),
    );
    expect(body.graph.persons.every((p: { canAddRelative: boolean }) => !p.canAddRelative)).toBe(
      true,
    );
    // Bro is private. Mum is "branch: 2" and Vee's card (Kid) is 2 steps away: Kid, Sara, Mum.
    expect(people.get('Bro')!.restricted).toBe(true);
    expect(people.get('Mum')!.restricted).toBeUndefined();
    expect(people.get('Dad')!.restricted).toBeUndefined();

    await db.update(persons).set({ privacySteps: 1 }).where(eq(persons.id, s.mum.id));
    const tighter = (await get(s.vee, `/api/v1/trees/${s.k}/links/${linkId}/graph`)).json();
    expect(
      tighter.graph.persons.find((p: { givenName: string }) => p.givenName === 'Mum').restricted,
    ).toBe(true);
  });

  it('gives an owner of one tree no rights in the other (V2)', async () => {
    const s = await setup();
    const linkId = await linked(s);
    const body = (await get(s.owner, `/api/v1/trees/${s.k}/links/${linkId}/graph`)).json();
    expect(
      body.graph.persons.find((p: { givenName: string }) => p.givenName === 'Bro').restricted,
    ).toBe(true);
    // Sara owns R: she sees everyone there.
    const asSara = (await get(s.sara, `/api/v1/trees/${s.k}/links/${linkId}/graph`)).json();
    expect(asSara.graph.persons.some((p: { restricted?: boolean }) => p.restricted)).toBe(false);
  });

  it('opens one linked person view-only, with the bridge as the own card', async () => {
    const s = await setup();
    const linkId = await linked(s);
    const url = (id: string) => `/api/v1/trees/${s.k}/links/${linkId}/persons/${id}`;
    const dad = (await get(s.vee, url(s.dad.id))).json();
    expect(dad.tree.name).toBe('Rahimi family');
    expect(dad.view.capabilities).toEqual({ edit: false, addRelative: false, delete: false });
    // The other tree's storage use and who made the card stay with that tree.
    expect(dad.view.photoUsage).toEqual({ usedBytes: 0, limitBytes: 0 });
    expect(dad.view.person.createdByName).toBeNull();
    const kids = dad.view.relations.unions[0].children.map(
      (c: { person: { id: string } }) => c.person.id,
    );
    expect(kids.sort()).toEqual([s.saraK.id, s.bro.id].sort());
    expect((await get(s.vee, url(s.bro.id))).json().view.person.restricted).toBe(true);
    // R's own Sara card isn't reachable through the link, nor is a K person.
    expect((await get(s.vee, url(s.saraR.id))).statusCode).toBe(404);
    expect((await get(s.vee, url(s.kid.id))).statusCode).toBe(404);
  });

  it('finds linked people in search and draws the path across the bridge', async () => {
    const s = await setup();
    await linked(s);
    const found = (await get(s.vee, `/api/v1/trees/${s.k}/search?q=Dad`)).json();
    expect(found.results).toEqual([]);
    expect(found.inLinkedTrees).toHaveLength(1);
    expect(found.inLinkedTrees[0]).toMatchObject({ id: s.dad.id, treeName: 'Rahimi family' });
    expect(found.inLinkedTrees[0].relation).toHaveLength(2);
    // The bridge's R card is never a match: she is found as her K card.
    const sara = (await get(s.vee, `/api/v1/trees/${s.k}/search?q=Sara`)).json();
    expect(sara.results.map((r: { id: string }) => r.id)).toEqual([s.saraK.id]);
    expect(sara.inLinkedTrees).toEqual([]);

    const rel = await get(
      s.vee,
      `/api/v1/trees/${s.k}/relationship?from=${s.kid.id}&to=${s.bro.id}`,
    );
    expect(rel.statusCode).toBe(200);
    // Kid → mother Sara (the bridge) → her father Dad → his son Bro.
    expect(rel.json().steps).toHaveLength(3);
    expect(rel.json().persons.at(-1)).toMatchObject({ id: s.bro.id, restricted: true });
  });

  it('reaches direct links only, never a tree two links away (L4)', async () => {
    const s = await setup();
    await linked(s);
    // Sara owns R and a third tree X: linking them is live at once.
    const x = (
      await call(app, 'POST', '/api/v1/trees', {
        jar: s.sara.jar,
        body: { name: 'Third tree', person: { givenName: 'Sara' } },
      })
    ).json().tree.id as string;
    const rx = await post(s.sara, `/api/v1/trees/${s.r}/links`, { otherTreeId: x });
    expect(rx.statusCode).toBe(201);
    const fromK = (await get(s.vee, `/api/v1/trees/${s.k}/links`)).json().links;
    expect(fromK.map((l: { otherTree: { id: string } }) => l.otherTree.id)).toEqual([s.r]);
    expect((await get(s.vee, `/api/v1/trees/${s.k}/links/${rx.json().id}/graph`)).statusCode).toBe(
      404,
    );
    const [tree] = await db.select().from(trees).where(eq(trees.id, x));
    expect(tree!.deletedAt).toBeNull();
  });
});
