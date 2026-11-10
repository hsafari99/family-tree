import { exportDataSchema } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import http from 'node:http';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, signUp } from '../../test/auth-helpers.js';
import { jpegWithExif, SECRET } from '../../test/photo-fixtures.js';
import { addPhotoRow, upload } from '../../test/photo-helpers.js';
import {
  addMember,
  addPerson,
  family,
  ownerWithTree,
  softDeleteBatch,
} from '../../test/tree-helpers.js';
import { readZip } from '../../test/zip-reader.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { parentChild, persons, photos, residences, trees } from '../db/schema.js';
import { createDeps } from '../deps.js';

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

/** Promise.withResolvers needs the es2024 lib, which this package doesn't target. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const url = (t: string) => `/api/v1/trees/${t}/export`;
const rootOf = async (treeId: string) =>
  (await db.select({ r: trees.rootPersonId }).from(trees).where(eq(trees.id, treeId)))[0]!.r!;

async function exportOf(jar: unknown, treeId: string) {
  const res = await call(app, 'GET', url(treeId), { jar: jar as never });
  expect(res.statusCode, res.statusCode === 200 ? '' : res.body).toBe(200);
  const files = new Map(readZip(res.rawPayload).map((f) => [f.name, f]));
  const ged = files.get('tree.ged')!.data.toString('utf8');
  const json = exportDataSchema.parse(JSON.parse(files.get('tree.json')!.data.toString('utf8')));
  return { res, files, ged, json };
}

describe('GET export', () => {
  it('streams a ZIP with tree.ged, tree.json and the full photos', async () => {
    const { owner, treeId } = await ownerWithTree(app, 'Export tree');
    const root = await rootOf(treeId);
    await db
      .update(persons)
      .set({ birthDate: { qualifier: 'about', date1: '1950' }, birthPlace: 'São Paulo' })
      .where(eq(persons.id, root));
    const partner = await addPerson(db, treeId, 'Zoë', { surname: 'Núñez', sex: 'female' });
    const child = await addPerson(db, treeId, 'Kid', { surname: 'Owner' });
    const u = await family(db, treeId, { id: root }, partner, [child]);
    await db.update(parentChild).set({ kind: 'adoptive' }).where(eq(parentChild.unionId, u.id));
    await db.insert(residences).values({ treeId, personId: root, place: 'Leeds' });
    const up = await upload(
      app,
      `/api/v1/trees/${treeId}/persons/${root}/photos`,
      owner.jar,
      await jpegWithExif(),
    );
    expect(up.statusCode).toBe(201);

    const { res, files, ged, json } = await exportOf(owner.jar, treeId);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="family-tree-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    // The web app is on another origin: it can only read the file name if CORS exposes it.
    expect(res.headers['access-control-expose-headers']).toMatch(/content-disposition/i);
    expect([...files.keys()].sort()).toEqual(['photos/I1-1.webp', 'tree.ged', 'tree.json']);

    expect(ged.startsWith('﻿0 HEAD\r\n')).toBe(true);
    expect(ged).toContain('\r\n1 CHAR UTF-8\r\n');
    expect(ged).toContain('\r\n2 DATE ABT 1950\r\n2 PLAC São Paulo\r\n');
    expect(ged).toContain('\r\n1 NAME Zoë /Núñez/\r\n');
    expect(ged).toContain('\r\n2 PEDI adopted\r\n');
    expect(ged).toContain('\r\n1 OBJE @O1@\r\n');
    expect(ged).toContain('\r\n1 FILE photos/I1-1.webp\r\n');
    expect(ged.endsWith('\r\n0 TRLR\r\n')).toBe(true);
    expect(files.get('tree.ged')!.method).toBe(8);

    expect(json.tree.id).toBe(treeId);
    expect(json.persons.map((p) => p.givenName)).toEqual(['Olive', 'Zoë', 'Kid']);
    expect(json.residences.map((r) => r.place)).toEqual(['Leeds']);
    expect(json.photos).toEqual([
      expect.objectContaining({ personId: root, file: 'photos/I1-1.webp', isPrimary: true }),
    ]);
    expect(JSON.stringify(json)).not.toMatch(/trees\/|X-Amz|webp\?/); // no keys or URLs

    // The stored, re-encoded photo byte for byte, stored uncompressed; no upload EXIF survives.
    const [row] = await db.select().from(photos).where(eq(photos.treeId, treeId));
    const stored = await deps.storage.get(row!.storageKeyFull);
    const exported = files.get('photos/I1-1.webp')!;
    expect(exported.method).toBe(0);
    expect(exported.data.equals(Buffer.from(stored!))).toBe(true);
    expect(exported.data.includes(Buffer.from(SECRET))).toBe(false);
  });

  it('leaves out Trash, and photos whose stored object is gone', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const root = await rootOf(treeId);
    const gone = await addPerson(db, treeId, 'Gone');
    await addPhotoRow(db, treeId, gone.id);
    await softDeleteBatch(db, treeId, owner.userId, [gone.id]);
    await addPhotoRow(db, treeId, root); // a row without an object
    const { files, ged, json } = await exportOf(owner.jar, treeId);
    expect([...files.keys()].sort()).toEqual(['tree.ged', 'tree.json']);
    expect(json.persons.map((p) => p.givenName)).toEqual(['Olive']);
    expect(json.photos).toEqual([expect.objectContaining({ personId: root, file: null })]);
    expect(ged).not.toContain('OBJE');
    expect(ged).not.toContain('Gone');
  });

  it('is for the owner only: members get 403, outsiders 404, no session 401', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    const editor = await signUp(app, { name: 'Ed' });
    const viewer = await signUp(app, { name: 'Vi' });
    await addMember(db, treeId, editor.userId, 'editor', owner.userId);
    await addMember(db, treeId, viewer.userId, 'viewer', owner.userId);
    const outsider = await signUp(app, { name: 'Out' });
    for (const [jar, status, code] of [
      [editor.jar, 403, 'FORBIDDEN'],
      [viewer.jar, 403, 'FORBIDDEN'],
      [outsider.jar, 404, 'NOT_FOUND'],
    ] as const) {
      const res = await call(app, 'GET', url(treeId), { jar });
      expect(res.statusCode).toBe(status);
      expect(res.json().error.code).toBe(code);
    }
    expect((await call(app, 'GET', url(treeId))).statusCode).toBe(401);
  });

  it('allows 5 exports an hour per user', async () => {
    const { owner, treeId } = await ownerWithTree(app);
    for (let i = 0; i < 5; i++) {
      expect((await call(app, 'GET', url(treeId), { jar: owner.jar })).statusCode).toBe(200);
    }
    const res = await call(app, 'GET', url(treeId), { jar: owner.jar });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });

  it('answers 503 when every export slot is busy, after the access check', async () => {
    await app.close();
    app = buildApp({
      config,
      checks: deps.checks,
      auth,
      db,
      storage: deps.storage,
      exportConcurrency: 0,
    });
    const { owner, treeId } = await ownerWithTree(app);
    const res = await call(app, 'GET', url(treeId), { jar: owner.jar });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json().error.code).toBe('RATE_LIMITED');
    const outsider = await signUp(app, { name: 'Out' });
    expect((await call(app, 'GET', url(treeId), { jar: outsider.jar })).statusCode).toBe(404);
  });

  it('allows one export at a time per user, while another owner can still export', async () => {
    const gate = deferred();
    const entered = deferred();
    let calls = 0;
    const storage = {
      ...deps.storage,
      async get(key: string) {
        if (calls++ === 0) {
          entered.resolve();
          await gate.promise; // the first photo fetch hangs until released
        }
        return deps.storage.get(key);
      },
    };
    await app.close();
    app = buildApp({ config, checks: deps.checks, auth, db, storage });
    const a = await ownerWithTree(app, 'A');
    await addPhotoRow(db, a.treeId, await rootOf(a.treeId));
    const b = await ownerWithTree(app, 'B');
    const first = call(app, 'GET', url(a.treeId), { jar: a.owner.jar });
    await entered.promise;
    const again = await call(app, 'GET', url(a.treeId), { jar: a.owner.jar });
    expect(again.statusCode).toBe(503);
    expect(again.json().error.code).toBe('RATE_LIMITED');
    expect((await call(app, 'GET', url(b.treeId), { jar: b.owner.jar })).statusCode).toBe(200);
    gate.resolve();
    expect((await first).statusCode).toBe(200);
    expect((await call(app, 'GET', url(a.treeId), { jar: a.owner.jar })).statusCode).toBe(200);
  });

  it('aborts an export that runs past the time limit, and frees its slot', async () => {
    const never = new Promise<never>(() => {});
    let calls = 0;
    const storage = {
      ...deps.storage,
      async get(key: string) {
        if (calls++ === 0) await never; // storage hangs for the first photo
        return deps.storage.get(key);
      },
    };
    await app.close();
    app = buildApp({ config, checks: deps.checks, auth, db, storage, exportTimeoutMs: 200 });
    const { owner, treeId } = await ownerWithTree(app);
    await addPhotoRow(db, treeId, await rootOf(treeId));
    const first = await call(app, 'GET', url(treeId), { jar: owner.jar }).catch(() => null);
    if (first) expect(() => readZip(first.rawPayload)).toThrow(); // never a valid archive
    expect((await call(app, 'GET', url(treeId), { jar: owner.jar })).statusCode).toBe(200);
  });

  it('writes tree.json objects with exactly the expected keys', async () => {
    const { owner, treeId } = await ownerWithTree(app, 'Keys');
    const root = await rootOf(treeId);
    const partner = await addPerson(db, treeId, 'Pat', { sex: 'female' });
    const child = await addPerson(db, treeId, 'Kid');
    await family(db, treeId, { id: root }, partner, [child]);
    await db.insert(residences).values({ treeId, personId: root, place: 'Leeds' });
    await addPhotoRow(db, treeId, root);
    const res = await call(app, 'GET', url(treeId), { jar: owner.jar });
    const raw = JSON.parse(
      new Map(readZip(res.rawPayload).map((f) => [f.name, f]))
        .get('tree.json')!
        .data.toString('utf8'),
    ) as Record<string, unknown>;
    const keys = (o: unknown) => Object.keys(o as object).sort();
    const first = (name: string) => (raw[name] as unknown[])[0];
    expect(keys(raw)).toEqual(
      [
        'exportedAt',
        'format',
        'parentChild',
        'persons',
        'photos',
        'residences',
        'tree',
        'unions',
        'version',
      ].sort(),
    );
    expect(keys(raw.tree)).toEqual(['id', 'name', 'rootPersonId']);
    expect(keys(first('persons'))).toEqual(
      [
        'id',
        'givenName',
        'middleName',
        'surname',
        'maidenName',
        'nickname',
        'sex',
        'birthDate',
        'birthPlace',
        'deathDate',
        'deathPlace',
        'causeOfDeath',
        'isLiving',
        'occupation',
        'education',
        'biography',
        'notes',
        'siblingOrder',
      ].sort(),
    );
    expect(keys(first('unions'))).toEqual(
      ['id', 'partnerAId', 'partnerBId', 'type', 'status', 'startDate', 'endDate'].sort(),
    );
    expect(keys(first('parentChild'))).toEqual(['id', 'unionId', 'childId', 'kind'].sort());
    expect(keys(first('residences'))).toEqual(
      ['id', 'personId', 'place', 'fromDate', 'toDate'].sort(),
    );
    expect(keys(first('photos'))).toEqual(
      ['id', 'personId', 'file', 'width', 'height', 'isPrimary'].sort(),
    );
  });

  describe('slots and aborts', () => {
    /** A get() that hangs until its signal aborts, recording the signal it was given. */
    function hangingStore(seen: {
      signal?: AbortSignal;
      hung?: boolean;
      entered: ReturnType<typeof deferred>;
    }) {
      return {
        ...deps.storage,
        async get(key: string, signal?: AbortSignal) {
          if (seen.hung) return deps.storage.get(key, signal);
          seen.hung = true;
          seen.signal = signal;
          seen.entered.resolve();
          await new Promise<void>((_, reject) => {
            if (!signal) return; // no signal passed: hangs for good (the bug under test)
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
          return null;
        },
      };
    }

    it('aborts a pending store read, and frees the slot, when the client disconnects', async () => {
      const seen: { signal?: AbortSignal; hung?: boolean; entered: ReturnType<typeof deferred> } = {
        entered: deferred(),
      };
      await app.close();
      app = buildApp({ config, checks: deps.checks, auth, db, storage: hangingStore(seen) });
      const { owner, treeId } = await ownerWithTree(app);
      await addPhotoRow(db, treeId, await rootOf(treeId));
      await app.listen({ port: 0, host: '127.0.0.1' });
      const port = (app.server.address() as { port: number }).port;
      const req = http.get(
        { host: '127.0.0.1', port, path: url(treeId), headers: { cookie: owner.jar.header() } },
        (res) => res.resume(),
      );
      req.on('error', () => {});
      await seen.entered.promise;
      req.destroy(); // the client leaves while the photo read is pending
      await vi.waitFor(() => expect(seen.signal?.aborted).toBe(true));
      // The same user can export again at once: the slot was freed.
      const second = await call(app, 'GET', url(treeId), { jar: owner.jar });
      expect(second.statusCode).toBe(200);
    });

    it('aborts the pending read at the time limit', async () => {
      const seen: { signal?: AbortSignal; hung?: boolean; entered: ReturnType<typeof deferred> } = {
        entered: deferred(),
      };
      await app.close();
      app = buildApp({
        config,
        checks: deps.checks,
        auth,
        db,
        storage: hangingStore(seen),
        exportTimeoutMs: 200,
      });
      const { owner, treeId } = await ownerWithTree(app);
      await addPhotoRow(db, treeId, await rootOf(treeId));
      await call(app, 'GET', url(treeId), { jar: owner.jar }).catch(() => null);
      expect(seen.signal?.aborted).toBe(true);
    });

    it('frees the slot when storage fails mid-stream', async () => {
      let calls = 0;
      const storage = {
        ...deps.storage,
        async get(key: string, signal?: AbortSignal) {
          if (calls++ === 0) throw new Error('storage is down');
          return deps.storage.get(key, signal);
        },
      };
      await app.close();
      app = buildApp({ config, checks: deps.checks, auth, db, storage });
      const { owner, treeId } = await ownerWithTree(app);
      await addPhotoRow(db, treeId, await rootOf(treeId));
      const first = await call(app, 'GET', url(treeId), { jar: owner.jar }).catch(() => null);
      if (first) expect(() => readZip(first.rawPayload)).toThrow();
      const second = await call(app, 'GET', url(treeId), { jar: owner.jar });
      expect(second.statusCode).toBe(200);
      expect(() => readZip(second.rawPayload)).not.toThrow();
    });
  });

  describe('the preflight check', () => {
    const check = (t: string) => `${url(t)}?check=1`;

    it('returns a one-time ticket that the download accepts, counting once against the limit', async () => {
      const { owner, treeId } = await ownerWithTree(app);
      for (let i = 0; i < 5; i++) {
        const c = await call(app, 'GET', check(treeId), { jar: owner.jar });
        expect(c.statusCode).toBe(200);
        const { ticket } = c.json() as { ticket: string };
        const d = await call(app, 'GET', `${url(treeId)}?ticket=${ticket}`, { jar: owner.jar });
        expect(d.statusCode).toBe(200);
        expect(d.headers['content-type']).toBe('application/zip');
        expect(d.headers['content-disposition']).toMatch(/^attachment;/);
      }
      const sixth = await call(app, 'GET', check(treeId), { jar: owner.jar });
      expect(sixth.statusCode).toBe(429);
      expect(sixth.json().error.code).toBe('RATE_LIMITED');
    });

    it('refuses a reused, foreign or unknown ticket the free pass', async () => {
      const a = await ownerWithTree(app, 'A');
      const b = await ownerWithTree(app, 'B');
      const { ticket } = (await call(app, 'GET', check(a.treeId), { jar: a.owner.jar })).json() as {
        ticket: string;
      };
      // Another user, another tree: the ticket doesn't work, and the request counts normally.
      const foreign = await call(app, 'GET', `${url(b.treeId)}?ticket=${ticket}`, {
        jar: b.owner.jar,
      });
      expect(foreign.statusCode).toBe(200);
      expect(
        (await call(app, 'GET', `${url(a.treeId)}?ticket=${ticket}`, { jar: a.owner.jar }))
          .statusCode,
      ).toBe(200);
      // Used once: a second use is an ordinary (counted) request, still served, never an error.
      expect(
        (await call(app, 'GET', `${url(a.treeId)}?ticket=${ticket}`, { jar: a.owner.jar }))
          .statusCode,
      ).toBe(200);
    });

    it('does not honour a ticket on a preflight: ?check=1&ticket=T is rate-limited', async () => {
      const { owner, treeId } = await ownerWithTree(app);
      const { ticket } = (await call(app, 'GET', check(treeId), { jar: owner.jar })).json() as {
        ticket: string;
      };
      // One preflight is already counted; four more fill the hour, whatever ticket rides along.
      for (let i = 0; i < 4; i++) {
        const c = await call(app, 'GET', `${check(treeId)}&ticket=${ticket}`, { jar: owner.jar });
        expect(c.statusCode).toBe(200);
      }
      const sixth = await call(app, 'GET', `${check(treeId)}&ticket=${ticket}`, {
        jar: owner.jar,
      });
      expect(sixth.statusCode).toBe(429);
      expect(sixth.json().error.code).toBe('RATE_LIMITED');
    });

    it('keeps the order: no session 401, outsiders 404, members 403, tooLarge 400', async () => {
      const { owner, treeId } = await ownerWithTree(app);
      const outsider = await signUp(app, { name: 'Out' });
      const editor = await signUp(app, { name: 'Ed' });
      await addMember(db, treeId, editor.userId, 'editor', owner.userId);
      expect((await call(app, 'GET', check(treeId))).statusCode).toBe(401);
      expect((await call(app, 'GET', check(treeId), { jar: outsider.jar })).statusCode).toBe(404);
      expect((await call(app, 'GET', check(treeId), { jar: editor.jar })).statusCode).toBe(403);
      await addPhotoRow(db, treeId, await rootOf(treeId));
      await addPhotoRow(db, treeId, await rootOf(treeId), false);
      await db.update(photos).set({ bytes: 2_000_000_000 }).where(eq(photos.treeId, treeId));
      const big = await call(app, 'GET', check(treeId), { jar: owner.jar });
      expect(big.statusCode).toBe(400);
      expect(big.json().error.details).toEqual({ reason: 'tooLarge' });
    });

    it('answers 503 when busy', async () => {
      await app.close();
      app = buildApp({
        config,
        checks: deps.checks,
        auth,
        db,
        storage: deps.storage,
        exportConcurrency: 0,
      });
      const { owner, treeId } = await ownerWithTree(app);
      const res = await call(app, 'GET', check(treeId), { jar: owner.jar });
      expect(res.statusCode).toBe(503);
    });
  });
});
