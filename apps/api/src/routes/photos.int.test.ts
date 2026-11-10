import { count, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, signUp, type CookieJar } from '../../test/auth-helpers.js';
import { gif, jpegWithExif, png, pngHeaderOnly, SECRET, webp } from '../../test/photo-fixtures.js';
import { addPhotoRow, objectExists, upload } from '../../test/photo-helpers.js';
import {
  addGrant,
  addMember,
  addPerson,
  auditRows,
  family,
  ownerWithTree,
  softDeleteBatch,
  userWith2fa,
} from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { auditLog, photos, storageDeletions } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { drainStorageDeletions } from '../storage/deletions.js';

vi.mock('../storage/deletions.js', async (orig) => {
  const m = await orig<typeof import('../storage/deletions.js')>();
  return { ...m, drainStorageDeletions: vi.fn(m.drainStorageDeletions) };
});
import { limiter } from '../photos/limiter.js';

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

const photosUrl = (treeId: string, personId: string) =>
  `/api/v1/trees/${treeId}/persons/${personId}/photos`;
const photoUrl = (treeId: string, photoId: string) => `/api/v1/trees/${treeId}/photos/${photoId}`;

async function setup() {
  const { owner, treeId } = await ownerWithTree(app);
  const person = await addPerson(db, treeId, 'Pic');
  return { owner, treeId, person, url: photosUrl(treeId, person.id) };
}
const rowCount = async (treeId: string) =>
  (await db.select({ n: count() }).from(photos).where(eq(photos.treeId, treeId)))[0]!.n;
const outboxCount = async () => (await db.select({ n: count() }).from(storageDeletions))[0]!.n;

describe('upload', () => {
  it('re-encodes, strips metadata and serves signed URLs', async () => {
    const { owner, treeId, person, url } = await setup();
    const res = await upload(app, url, owner.jar, await jpegWithExif({ orientation: 6 }));
    expect(res.statusCode).toBe(201);
    const { photo, usage } = res.json();
    expect(photo.isPrimary).toBe(true);
    expect([photo.width, photo.height]).toEqual([200, 400]);
    expect(photo.bytes).toBeGreaterThan(0);
    expect(usage).toEqual({ usedBytes: photo.bytes, limitBytes: config.MAX_PHOTO_BYTES_PER_TREE });
    for (const u of [photo.fullUrl, photo.thumbUrl]) {
      const r = await fetch(u);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/webp');
      const buf = Buffer.from(await r.arrayBuffer());
      expect((await sharp(buf).metadata()).exif).toBeUndefined();
      expect(buf.includes(Buffer.from(SECRET))).toBe(false);
    }
    const [row] = await db.select().from(photos).where(eq(photos.id, photo.id));
    expect(row!.storageKeyFull).toBe(`trees/${treeId}/photos/${photo.id}/full.webp`);
    expect(row!.storageKeyThumb).toBe(`trees/${treeId}/photos/${photo.id}/thumb.webp`);
    expect(row!.personId).toBe(person.id);
  });

  it('accepts PNG and WebP; later photos are not primary', async () => {
    const { owner, url } = await setup();
    const a = await upload(app, url, owner.jar, await png(), 'image/png');
    expect(a.statusCode).toBe(201);
    const b = await upload(app, url, owner.jar, await webp(), 'image/webp');
    expect(b.statusCode).toBe(201);
    expect(a.json().photo.isPrimary).toBe(true);
    expect(b.json().photo.isPrimary).toBe(false);
  });

  it('refuses bad files and leaves nothing behind', async () => {
    const { owner, treeId, url } = await setup();
    const whole = await jpegWithExif({ width: 800, height: 600 });
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const cases: [string, Buffer, string, number, string][] = [
      ['gif as jpeg', await gif(), 'image/jpeg', 400, 'type'],
      ['text as png', Buffer.from('just text'), 'image/png', 400, 'type'],
      ['gif type', await gif(), 'image/gif', 415, 'type'],
      ['bomb', pngHeaderOnly(20_000, 20_000), 'image/png', 400, 'dimensions'],
      ['truncated', whole.subarray(0, whole.length >> 1), 'image/jpeg', 400, 'unreadable'],
      ['too large', big, 'image/jpeg', 413, 'tooLarge'],
    ];
    const outboxBefore = await outboxCount();
    for (const [name, body, type, status, reason] of cases) {
      const res = await upload(app, url, owner.jar, body, type);
      expect([name, res.statusCode]).toEqual([name, status]);
      expect(res.json().error.code).toBe('VALIDATION');
      expect(res.json().error.details.reason).toBe(reason);
    }
    const json = await call(app, 'POST', url, { jar: owner.jar, body: {} });
    expect(json.statusCode).toBe(400);
    expect(json.json().error.details.reason).toBe('type');
    expect(await rowCount(treeId)).toBe(0);
    expect(await outboxCount()).toBe(outboxBefore);
  });

  it('does not read the body for outsiders and viewers', async () => {
    const { owner, treeId, url } = await setup();
    const huge = Buffer.alloc(11 * 1024 * 1024);
    const outsider = await signUp(app, { name: 'Out' });
    expect((await upload(app, url, outsider.jar, huge)).statusCode).toBe(404);
    const viewer = await signUp(app, { name: 'View' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    expect((await upload(app, url, viewer.jar, huge)).statusCode).toBe(403);
    expect((await upload(app, url, undefined, huge)).statusCode).toBe(401);
  });

  it('applies roles and branch scope', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const robert = await addPerson(db, treeId, 'Robert');
    const dan = await addPerson(db, treeId, 'Dan');
    const george = await addPerson(db, treeId, 'George');
    await family(db, treeId, robert, null, [dan]);
    const who = async (name: string, role: 'editor' | 'viewer', twoFa: boolean, grant: boolean) => {
      const u = twoFa ? await userWith2fa(app, name) : await signUp(app, { name });
      await addMember(db, treeId, u.userId, role, owner.userId);
      if (grant) await addGrant(db, treeId, u.userId, robert.id, owner.userId);
      return u.jar;
    };
    const img = await png();
    const table: [string, CookieJar, string, number][] = [
      ['owner', owner.jar, dan.id, 201],
      ['editor', await who('Ed', 'editor', false, false), dan.id, 201],
      ['viewer', await who('Vi', 'viewer', false, false), dan.id, 403],
      ['steward in scope', await who('St', 'viewer', true, true), dan.id, 201],
      ['steward out of scope', await who('St2', 'viewer', true, true), george.id, 403],
      ['steward without 2fa', await who('St3', 'viewer', false, true), dan.id, 403],
    ];
    for (const [name, jar, personId, status] of table) {
      const up = await upload(app, photosUrl(treeId, personId), jar, img, 'image/png');
      expect([name, up.statusCode]).toEqual([name, status]);
      // Set primary and delete on an existing photo follow the same rules.
      const existing = await addPhotoRow(db, treeId, personId, false);
      const prim = await call(app, 'POST', `${photoUrl(treeId, existing.id)}/primary`, { jar });
      expect([name, prim.statusCode]).toEqual([name, status === 201 ? 204 : status]);
      const del = await call(app, 'DELETE', photoUrl(treeId, existing.id), { jar });
      expect([name, del.statusCode]).toEqual([name, status === 201 ? 204 : status]);
      const left = await db.select().from(photos).where(eq(photos.id, existing.id));
      expect(left).toHaveLength(status === 201 ? 0 : 1);
    }
  });

  it('hides photos of deleted people', async () => {
    const { owner, treeId, person, url } = await setup();
    const photo = await addPhotoRow(db, treeId, person.id);
    const batch = await softDeleteBatch(db, treeId, owner.userId, [person.id]);
    expect((await upload(app, url, owner.jar, await png(), 'image/png')).statusCode).toBe(404);
    expect(
      (await call(app, 'POST', `${photoUrl(treeId, photo.id)}/primary`, { jar: owner.jar }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(app, 'DELETE', photoUrl(treeId, photo.id), { jar: owner.jar })).statusCode,
    ).toBe(404);
    const restore = await call(app, 'POST', `/api/v1/trees/${treeId}/trash/${batch.id}/restore`, {
      jar: owner.jar,
    });
    expect(restore.statusCode).toBe(204);
    const view = await call(app, 'GET', `/api/v1/trees/${treeId}/persons/${person.id}`, {
      jar: owner.jar,
    });
    expect(view.json().photos.map((p: { id: string }) => p.id)).toEqual([photo.id]);
  });
});

describe('primary and delete', () => {
  it('sets primary once, audited, and is a no-op the second time', async () => {
    const { owner, treeId, url } = await setup();
    const a = (await upload(app, url, owner.jar, await png(), 'image/png')).json().photo;
    const b = (await upload(app, url, owner.jar, await webp(), 'image/webp')).json().photo;
    const set = () => call(app, 'POST', `${photoUrl(treeId, b.id)}/primary`, { jar: owner.jar });
    expect((await set()).statusCode).toBe(204);
    const rows = await db
      .select()
      .from(photos)
      .where(inArray(photos.id, [a.id, b.id]));
    expect(rows.find((r) => r.id === b.id)!.isPrimary).toBe(true);
    expect(rows.find((r) => r.id === a.id)!.isPrimary).toBe(false);
    const n = (await auditRows(db, treeId)).filter((r) => r.action === 'photo.primary').length;
    expect(n).toBe(1);
    expect((await set()).statusCode).toBe(204);
    expect((await auditRows(db, treeId)).filter((r) => r.action === 'photo.primary')).toHaveLength(
      1,
    );
  });

  it('deletes, promotes the newest and frees both objects', async () => {
    const { owner, treeId, url } = await setup();
    const a = (await upload(app, url, owner.jar, await png(), 'image/png')).json().photo;
    const b = (await upload(app, url, owner.jar, await webp(), 'image/webp')).json().photo;
    const [rowA] = await db.select().from(photos).where(eq(photos.id, a.id));
    const del = await call(app, 'DELETE', photoUrl(treeId, a.id), { jar: owner.jar });
    expect(del.statusCode).toBe(204);
    for (const k of [rowA!.storageKeyFull, rowA!.storageKeyThumb]) {
      expect(await objectExists(deps, k)).toBe(false);
      expect(
        await db.select().from(storageDeletions).where(eq(storageDeletions.key, k)),
      ).toHaveLength(0);
    }
    const [rowB] = await db.select().from(photos).where(eq(photos.id, b.id));
    expect(rowB!.isPrimary).toBe(true);
    const entry = (await auditRows(db, treeId)).find((r) => r.action === 'photo.delete');
    expect(entry!.before).toEqual({ width: a.width, height: a.height, bytes: a.bytes });
    expect((await call(app, 'DELETE', photoUrl(treeId, b.id), { jar: owner.jar })).statusCode).toBe(
      204,
    );
    expect(await rowCount(treeId)).toBe(0);
  });

  it('still answers 204 when the outbox drain itself throws, leaving the keys queued', async () => {
    const { owner, treeId, url } = await setup();
    const a = (await upload(app, url, owner.jar, await png(), 'image/png')).json().photo;
    const [row] = await db.select().from(photos).where(eq(photos.id, a.id));
    vi.mocked(drainStorageDeletions).mockRejectedValueOnce(new Error('db down'));
    const del = await call(app, 'DELETE', photoUrl(treeId, a.id), { jar: owner.jar });
    expect(del.statusCode).toBe(204);
    expect(await rowCount(treeId)).toBe(0);
    const keys = [row!.storageKeyFull, row!.storageKeyThumb];
    expect(
      await db.select().from(storageDeletions).where(inArray(storageDeletions.key, keys)),
    ).toHaveLength(2);
    await drainStorageDeletions(db, deps.storage, { keys });
  });
});

describe('limits', () => {
  it('keeps the committed photo and its objects when signing the response fails', async () => {
    const { owner, treeId, url } = await setup();
    const broken = buildApp({
      config,
      checks: deps.checks,
      auth,
      db,
      storage: { ...deps.storage, signedUrl: () => Promise.reject(new Error('sign down')) },
    });
    try {
      const res = await upload(broken, url, owner.jar, await png(), 'image/png');
      expect(res.statusCode).toBe(500);
    } finally {
      await broken.close();
    }
    const rows = await db.select().from(photos).where(eq(photos.treeId, treeId));
    expect(rows).toHaveLength(1);
    expect(await objectExists(deps, rows[0]!.storageKeyFull)).toBe(true);
    expect(await objectExists(deps, rows[0]!.storageKeyThumb)).toBe(true);
  });

  it('enforces the tree quota, counting Trash, until erased', async () => {
    const probe = await setup();
    const first = (await upload(app, probe.url, probe.owner.jar, await png(), 'image/png')).json()
      .photo;
    const small = buildApp({
      config: loadConfig({ ...process.env, MAX_PHOTO_BYTES_PER_TREE: String(first.bytes + 10) }),
      checks: deps.checks,
      auth,
      db,
      storage: deps.storage,
    });
    try {
      const { owner, treeId, person, url } = await (async () => {
        const t = await ownerWithTree(small);
        const p = await addPerson(db, t.treeId, 'Pic');
        const p2 = await addPerson(db, t.treeId, 'Other');
        return { ...t, person: p, other: p2, url: photosUrl(t.treeId, p.id) };
      })();
      const ok = await upload(small, url, owner.jar, await png(), 'image/png');
      expect(ok.statusCode).toBe(201);
      const second = await upload(small, url, owner.jar, await png(), 'image/png');
      expect(second.statusCode).toBe(403);
      expect(second.json().error.code).toBe('QUOTA_EXCEEDED');
      expect(await rowCount(treeId)).toBe(1);
      // Into Trash: still counts.
      const other = await addPerson(db, treeId, 'Other2');
      const batch = await softDeleteBatch(db, treeId, owner.userId, [person.id]);
      expect(
        (await upload(small, photosUrl(treeId, other.id), owner.jar, await png(), 'image/png'))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await call(small, 'DELETE', `/api/v1/trees/${treeId}/trash/${batch.id}`, {
            jar: owner.jar,
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (await upload(small, photosUrl(treeId, other.id), owner.jar, await png(), 'image/png'))
          .statusCode,
      ).toBe(201);
    } finally {
      await small.close();
    }
  });

  it('caps photos per person at 50', async () => {
    const { owner, treeId, person, url } = await setup();
    await db.insert(photos).values(
      Array.from({ length: 50 }, () => {
        const id = crypto.randomUUID();
        return {
          id,
          treeId,
          personId: person.id,
          storageKeyFull: `trees/${treeId}/photos/${id}/full.webp`,
          storageKeyThumb: `trees/${treeId}/photos/${id}/thumb.webp`,
          width: 1,
          height: 1,
          bytes: 1,
        };
      }),
    );
    const res = await upload(app, url, owner.jar, await png(), 'image/png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.reason).toBe('tooMany');
    expect(await rowCount(treeId)).toBe(50);
  });

  it('ends with one primary when two uploads race', async () => {
    const { owner, treeId, url } = await setup();
    const img = await png();
    const [x, y] = await Promise.all([
      upload(app, url, owner.jar, img, 'image/png'),
      upload(app, url, owner.jar, img, 'image/png'),
    ]);
    expect([x.statusCode, y.statusCode]).toEqual([201, 201]);
    const rows = await db.select().from(photos).where(eq(photos.treeId, treeId));
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it('rate limits uploads per user', async () => {
    const { owner, url } = await setup();
    const tiny = await png(8, 8);
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await upload(app, url, owner.jar, tiny, 'image/png')).statusCode;
      if (i < 30) expect(last).toBe(201);
    }
    expect(last).toBe(429);
  });

  it('answers 503 with Retry-After when processing is saturated', async () => {
    const busy = buildApp({
      config,
      checks: deps.checks,
      auth,
      db,
      storage: deps.storage,
      photoJobs: limiter(0, 0),
    });
    try {
      const { owner, treeId, url } = await (async () => {
        const t = await ownerWithTree(busy);
        const p = await addPerson(db, t.treeId, 'Pic');
        return { ...t, url: photosUrl(t.treeId, p.id) };
      })();
      const outboxBefore = await outboxCount();
      const res = await upload(busy, url, owner.jar, await png(), 'image/png');
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('RATE_LIMITED');
      expect(res.headers['retry-after']).toBe('5');
      expect(await rowCount(treeId)).toBe(0);
      expect(await outboxCount()).toBe(outboxBefore);
    } finally {
      await busy.close();
    }
  });
});

describe('person view and hygiene', () => {
  it('lists photos primary first with working URLs, and the usage', async () => {
    const { owner, treeId, person, url } = await setup();
    const a = (await upload(app, url, owner.jar, await png(), 'image/png')).json().photo;
    const b = (await upload(app, url, owner.jar, await webp(), 'image/webp')).json().photo;
    await call(app, 'POST', `${photoUrl(treeId, b.id)}/primary`, { jar: owner.jar });
    const viewer = await signUp(app, { name: 'View' });
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    const res = await call(app, 'GET', `/api/v1/trees/${treeId}/persons/${person.id}`, {
      jar: viewer.jar,
    });
    const body = res.json();
    expect(body.photos.map((p: { id: string }) => p.id)).toEqual([b.id, a.id]);
    expect((await fetch(body.photos[0].thumbUrl)).status).toBe(200);
    expect(body.photoUsage).toEqual({
      usedBytes: a.bytes + b.bytes,
      limitBytes: config.MAX_PHOTO_BYTES_PER_TREE,
    });
  });

  it('keeps storage keys and signed URLs out of the audit log', async () => {
    const { owner, treeId, url } = await setup();
    const p = (await upload(app, url, owner.jar, await png(), 'image/png')).json().photo;
    await call(app, 'DELETE', photoUrl(treeId, p.id), { jar: owner.jar });
    const text = JSON.stringify(
      await db.select().from(auditLog).where(eq(auditLog.treeId, treeId)),
    );
    expect(text).not.toMatch(/storage_key|trees\/|X-Amz-/);
  });
});
