// App-wide ceilings on sign-ups and photo storage.
import { count, gt } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { call, signUp, TEST_PASSWORD, uniqueEmail } from '../../test/auth-helpers.js';
import { png } from '../../test/photo-fixtures.js';
import { addPhotoRow, upload } from '../../test/photo-helpers.js';
import { addPerson, ownerWithTree } from '../../test/tree-helpers.js';
import { buildApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { loadConfig } from '../config.js';
import { users } from '../db/schema.js';
import { createDeps } from '../deps.js';

const base = loadConfig();
const deps = createDeps(base);
const { db } = deps;
afterAll(async () => {
  await deps.close();
});

const signUpsToday = async () =>
  (
    await db
      .select({ n: count() })
      .from(users)
      .where(gt(users.createdAt, new Date(Date.now() - 86_400_000)))
  )[0]!.n;

describe('MAX_SIGNUPS_PER_DAY', () => {
  it('refuses new accounts once the day’s ceiling is reached', async () => {
    const config = { ...base, MAX_SIGNUPS_PER_DAY: (await signUpsToday()) + 1 };
    const auth = createAuth({ config, db, rateLimitEnabled: false });
    const app = buildApp({ config, checks: deps.checks, auth, db });
    try {
      await signUp(app);
      const res = await call(app, 'POST', '/api/auth/sign-up/email', {
        body: { email: uniqueEmail(), password: TEST_PASSWORD, name: 'Late' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: 'SIGN_UPS_PAUSED' });
    } finally {
      await app.close();
    }
  });
});

describe('MAX_TOTAL_PHOTO_BYTES', () => {
  it('refuses uploads once the app-wide photo storage is full', async () => {
    const config = { ...base, MAX_TOTAL_PHOTO_BYTES: 1 };
    const auth = createAuth({ config, db, rateLimitEnabled: false });
    const app = buildApp({ config, checks: deps.checks, auth, db, storage: deps.storage });
    try {
      const { owner, treeId } = await ownerWithTree(app);
      const person = await addPerson(db, treeId, 'Pic');
      // At least one photo exists, so the 1-byte ceiling is reached.
      await addPhotoRow(db, treeId, person.id);
      const res = await upload(
        app,
        `/api/v1/trees/${treeId}/persons/${person.id}/photos`,
        owner.jar,
        await png(),
      );
      expect(res.statusCode).toBe(507);
      expect(res.json().error.code).toBe('STORAGE_FULL');
    } finally {
      await app.close();
    }
  });
});
