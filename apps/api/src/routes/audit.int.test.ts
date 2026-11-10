import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call } from '../../test/auth-helpers.js';
import {
  addGrant,
  addMember,
  addPerson,
  auditRows,
  ownerWithTree,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { branchStewards, persons, trees } from '../db/schema.js';
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

const sha = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

describe('audit of tree, member, steward and invite changes', () => {
  it('writes one row group per change, with no secrets and no person ids', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const base = `/api/v1/trees/${treeId}`;
    const ok = async (r: ReturnType<typeof call>, code: number) => {
      const res = await r;
      expect(res.statusCode, res.body).toBe(code);
      return res.body ? res.json() : null;
    };
    await ok(call(app, 'PATCH', base, { jar: owner.jar, body: { name: 'Renamed' } }), 204);
    const { id: second } = await ok(
      call(app, 'POST', `${base}/persons`, {
        jar: owner.jar,
        body: { person: { givenName: 'Sec' } },
      }),
      201,
    );
    await ok(call(app, 'PATCH', base, { jar: owner.jar, body: { rootPersonId: second } }), 204);
    const anchor = await addPerson(db, treeId, 'Anchor');
    const joiner = await userWith2fa(app, 'Joiner');
    const inv = await ok(
      call(app, 'POST', `${base}/invites`, {
        jar: owner.jar,
        body: { role: 'editor', stewardAnchorPersonId: anchor.id },
      }),
      201,
    );
    await ok(
      call(app, 'POST', '/api/v1/invites/accept', { jar: joiner.jar, body: { token: inv.token } }),
      200,
    );
    await ok(
      call(app, 'PATCH', `${base}/members/${joiner.userId}`, {
        jar: owner.jar,
        body: { role: 'viewer' },
      }),
      204,
    );
    const other = await addPerson(db, treeId, 'Other');
    const g = await ok(
      call(app, 'POST', `${base}/stewards`, {
        jar: owner.jar,
        body: { userId: joiner.userId, anchorPersonId: other.id },
      }),
      201,
    );
    await ok(call(app, 'DELETE', `${base}/stewards/${g.id}`, { jar: owner.jar }), 204);
    const inv2 = await ok(
      call(app, 'POST', `${base}/invites`, { jar: owner.jar, body: { role: 'viewer' } }),
      201,
    );
    await ok(call(app, 'DELETE', `${base}/invites/${inv2.id}`, { jar: owner.jar }), 204);
    await ok(call(app, 'DELETE', `${base}/invites/${inv2.id}`, { jar: owner.jar }), 204);
    await ok(call(app, 'DELETE', `${base}/members/${joiner.userId}`, { jar: owner.jar }), 204);
    await ok(call(app, 'DELETE', base, { jar: owner.jar }), 204);
    await ok(call(app, 'POST', `${base}/restore`, { jar: owner.jar }), 204);

    const rows = await auditRows(db, treeId);
    const groups: string[][] = [];
    let last = '';
    for (const r of rows) {
      const k = r.createdAt.toISOString();
      if (k !== last) groups.push([]);
      last = k;
      groups[groups.length - 1]!.push(r.action);
    }
    expect(groups.map((x) => [...x].sort())).toEqual([
      ['person.create', 'tree.create'],
      ['tree.rename'],
      ['person.create'],
      ['tree.changeRoot'],
      ['invite.create'],
      ['member.join', 'steward.grant'],
      ['member.role'],
      ['steward.grant'],
      ['steward.revoke'],
      ['invite.create'],
      ['invite.revoke'],
      ['member.remove', 'steward.revoke'],
      ['tree.delete'],
      ['tree.restore'],
    ]);
    expect(rows.find((r) => r.action === 'member.join')!.userId).toBe(joiner.userId);
    const hash = await sha(inv.token);
    for (const r of rows) {
      const text = JSON.stringify([r.before, r.after]);
      expect(text).not.toContain(inv.token);
      expect(text).not.toContain(hash);
      if (/^(member|steward|invite)\./.test(r.action)) expect(r.personIds).toEqual([]);
    }
  });

  it('writes steward.revoke for each derived grant', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const anchor = await addPerson(db, treeId, 'Anchor');
    const s1 = await userWith2fa(app, 'S1');
    const s2 = await userWith2fa(app, 'S2');
    await addMember(db, treeId, s1.userId, 'viewer', owner.userId);
    await addMember(db, treeId, s2.userId, 'viewer', owner.userId);
    const parent = await addGrant(db, treeId, s1.userId, anchor.id, owner.userId);
    await addGrant(db, treeId, s2.userId, anchor.id, s1.userId, parent.id);
    const res = await call(app, 'DELETE', `/api/v1/trees/${treeId}/stewards/${parent.id}`, {
      jar: owner.jar,
    });
    expect(res.statusCode).toBe(204);
    const revokes = (await auditRows(db, treeId)).filter((r) => r.action === 'steward.revoke');
    expect(revokes).toHaveLength(2);
  });

  it('audits the new owners own grants on transfer, and keeps derived ones', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const anchor = await addPerson(db, treeId, 'Anchor');
    const n = await userWith2fa(app, 'New');
    const m = await userWith2fa(app, 'Mem');
    await addMember(db, treeId, n.userId, 'viewer', owner.userId);
    await addMember(db, treeId, m.userId, 'viewer', owner.userId);
    const own = await addGrant(db, treeId, n.userId, anchor.id, owner.userId);
    const derived = await addGrant(db, treeId, m.userId, anchor.id, n.userId, own.id);
    const res = await call(app, 'POST', `/api/v1/trees/${treeId}/transfer`, {
      jar: owner.jar,
      body: { userId: n.userId },
    });
    expect(res.statusCode, res.body).toBe(204);
    const rows = await auditRows(db, treeId);
    const revokes = rows.filter((r) => r.action === 'steward.revoke');
    expect(revokes.map((r) => r.entityId)).toEqual([own.id]);
    expect(revokes[0]!.after).toEqual({ reason: 'became owner' });
    expect(rows.some((r) => r.action === 'ownership.transfer')).toBe(true);
    const [d] = await db.select().from(branchStewards).where(eq(branchStewards.id, derived.id));
    expect(d!.parentGrantId).toBeNull();
  });

  it('does not deadlock a root change against a person delete', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    for (let i = 0; i < 20; i++) {
      const p = await addPerson(db, treeId, `P${i}`);
      const [a, b] = await Promise.all([
        call(app, 'PATCH', `/api/v1/trees/${treeId}`, {
          jar: owner.jar,
          body: { rootPersonId: p.id },
        }),
        call(app, 'POST', `/api/v1/trees/${treeId}/persons/${p.id}/delete`, {
          jar: owner.jar,
          body: { mode: 'person' },
        }),
      ]);
      for (const r of [a, b]) expect(r.statusCode, r.body).toBeLessThan(500);
      // Whoever won the race, the root must be a live person.
      const [t] = await db.select().from(trees).where(eq(trees.id, treeId));
      const [root] = await db.select().from(persons).where(eq(persons.id, t!.rootPersonId!));
      expect(root!.deletedAt).toBeNull();
    }
  });
});
