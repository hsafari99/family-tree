import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signUp, type CookieJar } from '../../test/auth-helpers.js';
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
import { parentChild, residences } from '../db/schema.js';
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

const ROLES = ['owner', 'editor', 'viewer', 'steward', 'dormant', 'editorSteward'] as const;
type RoleName = (typeof ROLES)[number];

/** Robert + Mary -> Dan; Dan + Ann -> Leo; George + Greta -> Ann; Dan + (none) -> Kim. */
async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const [robert, mary, dan, ann, leo, george, greta, kim, scratch, dee, gil] = await Promise.all(
    ['Robert', 'Mary', 'Dan', 'Ann', 'Leo', 'George', 'Greta', 'Kim', 'Scratch', 'Dee', 'Gil'].map((n) =>
      addPerson(db, treeId, n),
    ),
  );
  const rm = await family(db, treeId, robert!, mary!, [dan!, dee!]);
  const danAnn = await family(db, treeId, dan!, ann!, [leo!]);
  await family(db, treeId, dan!, null, [kim!]);
  const gg = await family(db, treeId, george!, greta!, [ann!, gil!]);
  const batch = await softDeleteBatch(db, treeId, owner.userId, [scratch!.id]);
  const [residence] = await db
    .insert(residences)
    .values({ treeId, personId: dan!.id, place: 'Leeds' })
    .returning();
  const mk = async (name: string, role: 'editor' | 'viewer', twoFa: boolean, grant: boolean) => {
    const u = twoFa ? await userWith2fa(app, name) : await signUp(app, { name });
    await addMember(db, treeId, u.userId, role, owner.userId);
    if (grant) await addGrant(db, treeId, u.userId, robert!.id, owner.userId);
    return u.jar;
  };
  const jars: Record<RoleName, CookieJar> = {
    owner: owner.jar,
    editor: await mk('Edie', 'editor', false, false),
    viewer: await mk('Vera', 'viewer', false, false),
    steward: await mk('Sam', 'viewer', true, true),
    dormant: await mk('Dora', 'viewer', false, true),
    editorSteward: await mk('Ed', 'editor', true, true),
  };
  const [leoLink] = await db
    .select()
    .from(parentChild)
    .where(and(eq(parentChild.childId, leo!.id), eq(parentChild.unionId, danAnn.id)));
  return {
    treeId,
    jars,
    batchId: batch.id,
    p: { robert: robert!, dan: dan!, ann: ann!, george: george!, kim: kim!, greta: greta! },
    rm,
    gg,
    rmKids: [dan!.id, dee!.id],
    ggKids: [ann!.id, gil!.id],
    leoLink: leoLink!,
    residenceId: residence!.id,
  };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

interface Row {
  name: string;
  req: (
    c: Ctx,
  ) => [method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: Record<string, unknown>];
  /** owner, editor, viewer, steward, dormant, editorSteward */
  want: [number, number, number, number, number, number];
}
const T = (c: Ctx) => `/api/v1/trees/${c.treeId}`;
const ROWS: Row[] = [
  {
    name: 'POST person, unattached',
    req: (c) => ['POST', `${T(c)}/persons`, { person: { givenName: 'N' } }],
    want: [201, 201, 403, 403, 403, 201],
  },
  {
    name: 'POST person, child of Dan',
    req: (c) => [
      'POST',
      `${T(c)}/persons`,
      { person: { givenName: 'N' }, attach: { to: c.p.dan.id, as: 'child' } },
    ],
    want: [201, 201, 403, 201, 403, 201],
  },
  {
    name: 'POST person, child of George',
    req: (c) => [
      'POST',
      `${T(c)}/persons`,
      { person: { givenName: 'N' }, attach: { to: c.p.george.id, as: 'child' } },
    ],
    want: [201, 201, 403, 403, 403, 201],
  },
  {
    name: 'PATCH Dan',
    req: (c) => ['PATCH', `${T(c)}/persons/${c.p.dan.id}`, { version: 1, surname: 'Z' }],
    want: [200, 200, 403, 200, 403, 200],
  },
  {
    name: 'PATCH George',
    req: (c) => ['PATCH', `${T(c)}/persons/${c.p.george.id}`, { version: 1, surname: 'Z' }],
    want: [200, 200, 403, 403, 403, 200],
  },
  {
    name: 'PATCH union Robert+Mary',
    req: (c) => ['PATCH', `${T(c)}/unions/${c.rm.id}`, { status: 'divorced' }],
    want: [204, 204, 403, 204, 403, 204],
  },
  {
    name: 'PATCH union George+Greta',
    req: (c) => ['PATCH', `${T(c)}/unions/${c.gg.id}`, { status: 'divorced' }],
    want: [204, 204, 403, 403, 403, 204],
  },
  {
    name: 'POST residence on Dan',
    req: (c) => ['POST', `${T(c)}/persons/${c.p.dan.id}/residences`, { place: 'Hull' }],
    want: [201, 201, 403, 201, 403, 201],
  },
  {
    name: 'delete-preview Kim',
    req: (c) => ['POST', `${T(c)}/persons/${c.p.kim.id}/delete-preview`, { mode: 'person' }],
    want: [200, 403, 403, 200, 403, 200],
  },
  {
    name: 'delete Kim',
    req: (c) => ['POST', `${T(c)}/persons/${c.p.kim.id}/delete`, { mode: 'person' }],
    want: [200, 403, 403, 200, 403, 200],
  },
  {
    name: 'delete George',
    req: (c) => ['POST', `${T(c)}/persons/${c.p.george.id}/delete`, { mode: 'person' }],
    want: [200, 403, 403, 403, 403, 403],
  },
  {
    name: 'delete link Dan+Ann -> Leo',
    req: (c) => ['POST', `${T(c)}/parent-child/${c.leoLink.id}/delete`],
    want: [200, 403, 403, 403, 403, 403],
  },
  { name: 'GET trash', req: (c) => ['GET', `${T(c)}/trash`], want: [200, 403, 403, 403, 403, 403] },
  {
    name: 'restore a batch',
    req: (c) => ['POST', `${T(c)}/trash/${c.batchId}/restore`],
    want: [204, 403, 403, 403, 403, 403],
  },
  {
    name: 'GET person',
    req: (c) => ['GET', `${T(c)}/persons/${c.p.dan.id}`],
    want: [200, 200, 200, 200, 200, 200],
  },
  {
    name: 'GET history',
    req: (c) => ['GET', `${T(c)}/persons/${c.p.dan.id}/history`],
    want: [200, 200, 200, 200, 200, 200],
  },
  {
    name: 'GET people list',
    req: (c) => ['GET', `${T(c)}/persons`],
    want: [200, 200, 200, 200, 200, 200],
  },
  {
    name: 'PATCH residence on Dan',
    req: (c) => ['PATCH', `${T(c)}/residences/${c.residenceId}`, { place: 'York' }],
    want: [204, 204, 403, 204, 403, 204],
  },
  {
    name: 'DELETE residence on Dan',
    req: (c) => ['DELETE', `${T(c)}/residences/${c.residenceId}`],
    want: [204, 204, 403, 204, 403, 204],
  },
  {
    name: 'PATCH parent-child Leo',
    req: (c) => ['PATCH', `${T(c)}/parent-child/${c.leoLink.id}`, { kind: 'step' }],
    want: [204, 204, 403, 204, 403, 204],
  },
  {
    name: 'POST relative: Greta as Dan partner',
    req: (c) => [
      'POST',
      `${T(c)}/persons/${c.p.dan.id}/relatives`,
      { personId: c.p.greta.id, as: 'partner' },
    ],
    want: [204, 204, 403, 204, 403, 204],
  },
  {
    name: 'GET graph (full)',
    req: (c) => ['GET', `${T(c)}/graph?mode=full`],
    want: [200, 200, 200, 200, 200, 200],
  },
  {
    name: 'GET disconnected',
    req: (c) => ['GET', `${T(c)}/disconnected`],
    want: [200, 200, 200, 200, 200, 200],
  },
  {
    name: 'GET persons/similar',
    req: (c) => ['GET', `${T(c)}/persons/similar?givenName=Dan`],
    want: [200, 200, 200, 200, 200, 200],
  },
  {
    name: 'child-order Robert+Mary',
    req: (c) => ['POST', `${T(c)}/unions/${c.rm.id}/child-order`, { childIds: [...c.rmKids].reverse() }],
    want: [204, 204, 403, 204, 403, 204],
  },
  {
    name: 'child-order George+Greta',
    req: (c) => ['POST', `${T(c)}/unions/${c.gg.id}/child-order`, { childIds: [...c.ggKids].reverse() }],
    want: [204, 204, 403, 403, 403, 204],
  },
  {
    name: 'GET trash batch',
    req: (c) => ['GET', `${T(c)}/trash/${c.batchId}`],
    want: [200, 403, 403, 403, 403, 403],
  },
  {
    name: 'DELETE trash batch',
    req: (c) => ['DELETE', `${T(c)}/trash/${c.batchId}`],
    want: [204, 403, 403, 403, 403, 403],
  },
];

describe('people permission matrix', () => {
  const cases = ROWS.flatMap((row) =>
    ROLES.map((role, i) => [row.name, role, row, row.want[i]!] as const),
  );
  it.each(cases)(
    '%s as %s',
    async (_name, role, row, want) => {
      const ctx = await setup();
      const [method, url, body] = row.req(ctx);
      const res = await call(app, method, url, { jar: ctx.jars[role], ...(body ? { body } : {}) });
      expect(res.statusCode, res.body).toBe(want);
    },
    30_000,
  );

  it('marks canAddRelative in the graph by scope, and nowhere for a dormant steward', async () => {
    const ctx = await setup();
    const flags = async (role: RoleName) => {
      const res = await call(app, 'GET', `${T(ctx)}/graph?mode=full`, { jar: ctx.jars[role] });
      const list = res.json().persons as { id: string; canAddRelative: boolean }[];
      const f = (id: string) => list.find((x) => x.id === id)!.canAddRelative;
      return [f(ctx.p.dan.id), f(ctx.p.george.id)];
    };
    expect(await flags('steward')).toEqual([true, false]);
    expect(await flags('dormant')).toEqual([false, false]);
  });

  it('lets a steward add to a person they created, but not delete one tied to outsiders', async () => {
    const ctx = await setup();
    const jar = ctx.jars.steward;
    const made = await call(app, 'POST', `${T(ctx)}/persons`, {
      jar,
      body: { person: { givenName: 'Neo' }, attach: { to: ctx.p.dan.id, as: 'child' } },
    });
    expect(made.statusCode, made.body).toBe(201);
    const neo = made.json().id as string;
    const edit = await call(app, 'PATCH', `${T(ctx)}/persons/${neo}`, {
      jar,
      body: { version: 1, surname: 'Hale' },
    });
    expect(edit.statusCode).toBe(200);
    const link = await call(app, 'POST', `${T(ctx)}/persons/${neo}/relatives`, {
      jar,
      body: { personId: ctx.p.ann.id, as: 'partner' },
    });
    expect(link.statusCode, link.body).toBe(204);
    const del = await call(app, 'POST', `${T(ctx)}/persons/${neo}/delete`, {
      jar,
      body: { mode: 'person' },
    });
    expect(del.statusCode).toBe(403);
  });
});
