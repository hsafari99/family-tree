import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/client.js';
import { asc, eq, inArray } from 'drizzle-orm';
import {
  auditLog,
  branchStewards,
  deletionBatches,
  parentChild,
  persons,
  treeMembers,
  unions,
} from '../src/db/schema.js';
import { call, enableTwoFactor, signUp } from './auth-helpers.js';

export async function userWith2fa(app: FastifyInstance, name = 'Test User') {
  const user = await signUp(app, { name });
  const tf = await enableTwoFactor(app, user.jar, user.password);
  return { ...user, ...tf };
}

/** A user with 2FA who owns a new tree whose root is their own card. */
export async function ownerWithTree(app: FastifyInstance, treeName = 'Test tree') {
  const owner = await userWith2fa(app, 'Owner');
  const res = await call(app, 'POST', '/api/v1/trees', {
    jar: owner.jar,
    body: { name: treeName, person: { givenName: 'Olive', surname: 'Owner' } },
  });
  if (res.statusCode !== 201) throw new Error(`create tree failed: ${res.statusCode} ${res.body}`);
  const treeId = res.json().tree.id as string;
  return { owner, treeId };
}

export async function addPerson(
  db: Db,
  treeId: string,
  givenName: string,
  extra: Partial<typeof persons.$inferInsert> = {},
) {
  const [p] = await db
    .insert(persons)
    .values({ treeId, givenName, ...extra })
    .returning();
  return p!;
}

/** A union of a and b (b may be null) with the given children. */
export async function family(
  db: Db,
  treeId: string,
  a: { id: string },
  b: { id: string } | null,
  children: { id: string }[] = [],
) {
  const [u] = await db
    .insert(unions)
    .values({ treeId, partnerAId: a.id, partnerBId: b?.id ?? null })
    .returning();
  for (const c of children) {
    await db.insert(parentChild).values({ treeId, unionId: u!.id, childId: c.id });
  }
  return u!;
}

export async function addMember(
  db: Db,
  treeId: string,
  userId: string,
  role: 'editor' | 'viewer',
  invitedByUserId: string | null = null,
) {
  await db.insert(treeMembers).values({ treeId, userId, role, invitedByUserId });
}

export async function addGrant(
  db: Db,
  treeId: string,
  userId: string,
  anchorPersonId: string,
  grantedByUserId: string | null,
  parentGrantId: string | null = null,
) {
  const [g] = await db
    .insert(branchStewards)
    .values({ treeId, userId, anchorPersonId, grantedByUserId, parentGrantId })
    .returning();
  return g!;
}

/** Audit rows of a tree, oldest first. */
export async function auditRows(db: Db, treeId: string) {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.treeId, treeId))
    .orderBy(asc(auditLog.createdAt));
}

/** Soft-deletes people into a new person batch (for isolation snapshots). */
export async function softDeleteBatch(db: Db, treeId: string, userId: string, personIds: string[]) {
  const [b] = await db
    .insert(deletionBatches)
    .values({ treeId, deletedByUserId: userId, mode: 'person', rootPersonId: personIds[0]! })
    .returning();
  await db
    .update(persons)
    .set({ deletedAt: new Date(), deletionBatchId: b!.id })
    .where(inArray(persons.id, personIds));
  return b!;
}
