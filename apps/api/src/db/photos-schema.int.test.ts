import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createDeps } from '../deps.js';
import { persons, photos, storageDeletions, trees, users } from './schema.js';

const deps = createDeps(loadConfig());
const { db } = deps;

const treeIds: string[] = [];
const userIds: string[] = [];
const outboxKeys: string[] = [];

afterEach(async () => {
  const t = treeIds.splice(0);
  if (t.length > 0) await db.delete(trees).where(inArray(trees.id, t));
  const u = userIds.splice(0);
  if (u.length > 0) await db.delete(users).where(inArray(users.id, u));
  const k = outboxKeys.splice(0);
  if (k.length > 0) await db.delete(storageDeletions).where(inArray(storageDeletions.key, k));
});

afterAll(async () => {
  await deps.close();
});

async function newTree() {
  const [t] = await db
    .insert(trees)
    .values({ name: `photos-test-${crypto.randomUUID()}` })
    .returning();
  treeIds.push(t!.id);
  return t!;
}

async function newUser() {
  const [u] = await db
    .insert(users)
    .values({ name: 'Test', email: `photos-${crypto.randomUUID()}@example.com` })
    .returning();
  userIds.push(u!.id);
  return u!;
}

async function newPerson(treeId: string, extra: Partial<typeof persons.$inferInsert> = {}) {
  const [p] = await db
    .insert(persons)
    .values({ treeId, givenName: 'A', ...extra })
    .returning();
  return p!;
}

function photoValues(
  treeId: string,
  personId: string,
  extra: Partial<typeof photos.$inferInsert> = {},
) {
  const id = crypto.randomUUID();
  return {
    id,
    treeId,
    personId,
    storageKeyFull: `trees/${treeId}/photos/${id}/full.webp`,
    storageKeyThumb: `trees/${treeId}/photos/${id}/thumb.webp`,
    width: 10,
    height: 10,
    bytes: 100,
    ...extra,
  };
}

const pgCode = async (p: Promise<unknown>) => {
  const err = (await p.catch((e: unknown) => e)) as { code?: string; cause?: { code?: string } };
  return err?.cause?.code ?? err?.code;
};

describe('extensions and search_name', () => {
  it('has pg_trgm and unaccent', async () => {
    const rows = (await db.execute(sql`select extname from pg_extension`)) as unknown as {
      extname: string;
    }[];
    const names = rows.map((r) => r.extname);
    expect(names).toContain('pg_trgm');
    expect(names).toContain('unaccent');
  });

  it('folds every name to lower case without accents', async () => {
    const tree = await newTree();
    const p = await newPerson(tree.id, {
      givenName: 'José',
      middleName: 'María',
      surname: 'Núñez',
      maidenName: 'Pérez',
      nickname: 'Pepe',
    });
    expect(p.searchName!.split(/\s+/).filter(Boolean)).toEqual([
      'jose',
      'maria',
      'nunez',
      'perez',
      'pepe',
    ]);
    const [u] = await db
      .update(persons)
      .set({ surname: 'Ölund' })
      .where(eq(persons.id, p.id))
      .returning();
    expect(u!.searchName).toContain('olund');
  });

  it('cannot be written', async () => {
    const tree = await newTree();
    await expect(
      db.execute(
        sql`insert into persons (tree_id, given_name, search_name) values (${tree.id}, 'X', 'x')`,
      ),
    ).rejects.toThrow();
  });

  it('is served by the trigram index', async () => {
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const rows = (await tx.execute(
        sql`explain select id from persons where 'jose' <% search_name`,
      )) as unknown as Record<string, string>[];
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('persons_search_name_trgm_idx');
  });
});

describe('photos', () => {
  it('allows one primary per person', async () => {
    const tree = await newTree();
    const p = await newPerson(tree.id);
    await db.insert(photos).values(photoValues(tree.id, p.id, { isPrimary: true }));
    await db.insert(photos).values(photoValues(tree.id, p.id, { isPrimary: false }));
    expect(
      await pgCode(db.insert(photos).values(photoValues(tree.id, p.id, { isPrimary: true }))),
    ).toBe('23505');
  });

  it('refuses a person of another tree', async () => {
    const a = await newTree();
    const b = await newTree();
    const p = await newPerson(b.id);
    expect(await pgCode(db.insert(photos).values(photoValues(a.id, p.id)))).toBe('23503');
  });

  it('refuses zero bytes', async () => {
    const tree = await newTree();
    const p = await newPerson(tree.id);
    expect(await pgCode(db.insert(photos).values(photoValues(tree.id, p.id, { bytes: 0 })))).toBe(
      '23514',
    );
  });

  it('is removed with its person', async () => {
    const tree = await newTree();
    const p = await newPerson(tree.id);
    const v = photoValues(tree.id, p.id);
    await db.insert(photos).values(v);
    await db.delete(persons).where(eq(persons.id, p.id));
    expect(await db.select().from(photos).where(eq(photos.id, v.id))).toHaveLength(0);
  });

  it('keeps the photo when the uploader is deleted', async () => {
    const tree = await newTree();
    const p = await newPerson(tree.id);
    const u = await newUser();
    const v = photoValues(tree.id, p.id, { uploadedBy: u.id });
    await db.insert(photos).values(v);
    await db.delete(users).where(eq(users.id, u.id));
    const [row] = await db.select().from(photos).where(eq(photos.id, v.id));
    expect(row!.uploadedBy).toBeNull();
  });
});

describe('storage_deletions', () => {
  it('ignores a key queued twice', async () => {
    const key = `test/${crypto.randomUUID()}`;
    outboxKeys.push(key);
    await db.insert(storageDeletions).values({ key }).onConflictDoNothing();
    await db.insert(storageDeletions).values({ key }).onConflictDoNothing();
    const rows = await db.select().from(storageDeletions).where(eq(storageDeletions.key, key));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(0);
  });

  it('outlives its tree', async () => {
    const tree = await newTree();
    const key = `trees/${tree.id}/photos/x/full.webp`;
    outboxKeys.push(key);
    await db.insert(storageDeletions).values({ key });
    await db.delete(trees).where(eq(trees.id, tree.id));
    const rows = await db.select().from(storageDeletions).where(eq(storageDeletions.key, key));
    expect(rows).toHaveLength(1);
  });
});
