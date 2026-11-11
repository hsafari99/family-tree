import { AVATAR_UPLOAD_MAX_BYTES, PHOTO_THUMB_SIDE } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, signUp, type CookieJar } from '../../test/auth-helpers.js';
import { gif, jpegWithExif, png, SECRET, webp } from '../../test/photo-fixtures.js';
import { objectExists } from '../../test/photo-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { storageDeletions, users } from '../db/schema.js';
import { createDeps } from '../deps.js';
import { AVATAR_URL } from './avatar.js';

const config = loadConfig();
const deps = createDeps(config);
const { db } = deps;
// With the store, as in production: a deleted account's picture goes at once.
const auth = createAuth({ config, db, rateLimitEnabled: false, storage: deps.storage });

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

function put(jar: CookieJar | undefined, body: Buffer, type = 'image/png') {
  return app.inject({
    method: 'PUT',
    url: AVATAR_URL,
    headers: {
      origin: 'http://localhost:5173',
      'content-type': type,
      ...(jar ? { cookie: jar.header() } : {}),
    },
    payload: body,
  });
}
const keyOf = async (userId: string) =>
  (await db.select({ key: users.avatarKey }).from(users).where(eq(users.id, userId)))[0]?.key ??
  null;
const me = async (jar: CookieJar) => (await call(app, 'GET', '/api/v1/me', { jar })).json().user;

describe('profile picture', () => {
  it('starts with none; an upload is a metadata-free WebP square, shown on /me', async () => {
    const { jar, userId } = await signUp(app);
    expect((await me(jar)).avatarUrl).toBeNull();

    const res = await put(jar, await jpegWithExif({ width: 400, height: 200 }), 'image/jpeg');
    expect(res.statusCode).toBe(200);
    const key = await keyOf(userId);
    expect(key).toMatch(new RegExp(`^users/${userId}/avatar/[0-9a-f-]{36}\\.webp$`));
    expect(res.json().avatarUrl).toContain(key);
    expect((await me(jar)).avatarUrl).toContain(key);

    const stored = await deps.storage.get(key!);
    const meta = await sharp(Buffer.from(stored!)).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([PHOTO_THUMB_SIDE, PHOTO_THUMB_SIDE]);
    expect(meta.exif).toBeUndefined();
    expect(Buffer.from(stored!).includes(SECRET)).toBe(false);
  });

  it('replacing it deletes the old object', async () => {
    const { jar, userId } = await signUp(app);
    expect((await put(jar, await png())).statusCode).toBe(200);
    const first = (await keyOf(userId))!;
    expect((await put(jar, await webp(), 'image/webp')).statusCode).toBe(200);
    const second = (await keyOf(userId))!;
    expect(second).not.toBe(first);
    expect(await objectExists(deps, first)).toBe(false);
    expect(await objectExists(deps, second)).toBe(true);
  });

  it('removing it deletes the object and goes back to the default; removing again is fine', async () => {
    const { jar, userId } = await signUp(app);
    await put(jar, await png());
    const key = (await keyOf(userId))!;
    expect((await call(app, 'DELETE', AVATAR_URL, { jar })).statusCode).toBe(204);
    expect(await keyOf(userId)).toBeNull();
    expect(await objectExists(deps, key)).toBe(false);
    expect((await me(jar)).avatarUrl).toBeNull();
    expect((await call(app, 'DELETE', AVATAR_URL, { jar })).statusCode).toBe(204);
  });

  it('checks the type by magic bytes, not the Content-Type', async () => {
    const { jar, userId } = await signUp(app);
    const res = await put(jar, await gif(), 'image/png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION', details: { reason: 'type' } });
    const text = await put(jar, await gif(), 'image/gif');
    expect(text.statusCode).toBe(415);
    expect(text.json().error.details).toEqual({ reason: 'type' });
    expect(await keyOf(userId)).toBeNull();
  });

  it('refuses a file over the limit before decoding it', async () => {
    const { jar, userId } = await signUp(app);
    const big = Buffer.concat([await png(), Buffer.alloc(AVATAR_UPLOAD_MAX_BYTES)]);
    const res = await put(jar, big);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.details).toEqual({ reason: 'tooLarge' });
    expect(await keyOf(userId)).toBeNull();
  });

  it('only ever touches the signed-in user’s own picture', async () => {
    const ada = await signUp(app);
    const bob = await signUp(app);
    await put(ada.jar, await png());
    const adaKey = (await keyOf(ada.userId))!;
    // Bob's remove and upload change only Bob.
    expect((await call(app, 'DELETE', AVATAR_URL, { jar: bob.jar })).statusCode).toBe(204);
    await put(bob.jar, await webp(), 'image/webp');
    expect(await keyOf(ada.userId)).toBe(adaKey);
    expect(await objectExists(deps, adaKey)).toBe(true);
    // There is no URL for another user's picture.
    const other = await call(app, 'DELETE', `${AVATAR_URL}/${ada.userId}`, { jar: bob.jar });
    expect(other.statusCode).toBe(404);
    // Signed out: no body is read.
    expect((await put(undefined, await png())).statusCode).toBe(401);
    expect((await call(app, 'DELETE', AVATAR_URL)).statusCode).toBe(401);
  });

  it('deleting the account deletes the picture', async () => {
    const { jar, userId, password } = await signUp(app);
    await put(jar, await png());
    const key = (await keyOf(userId))!;
    const res = await call(app, 'POST', '/api/auth/delete-user', { jar, body: { password } });
    expect(res.statusCode).toBe(200);
    expect(await objectExists(deps, key)).toBe(false);
    const queued = await db.select().from(storageDeletions).where(eq(storageDeletions.key, key));
    expect(queued).toEqual([]);
  });

  it('a failed account delete keeps the picture', async () => {
    const { jar, userId } = await signUp(app);
    await put(jar, await png());
    const key = (await keyOf(userId))!;
    const res = await call(app, 'POST', '/api/auth/delete-user', {
      jar,
      body: { password: 'Not-the-password1' },
    });
    expect(res.statusCode).not.toBe(200);
    expect(await objectExists(deps, key)).toBe(true);
    expect(await keyOf(userId)).toBe(key);
  });
});
