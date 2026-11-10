import {
  hasCycle,
  type TrashBatch,
  type TrashBatchDetail,
  type TrashRoot,
} from '@family-tree/shared';
import { and, arrayOverlaps, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Queryable, Tx } from '../db/client.js';
import {
  auditLog,
  branchStewards,
  deletionBatches,
  invites,
  parentChild,
  persons,
  photos,
  treeMembers,
  unions,
  users,
} from '../db/schema.js';
import { conflict, isUniqueViolation, notFound } from '../errors.js';
import { queuePhotoObjects } from '../storage/deletions.js';
import { audit, type AuditActor } from './audit.js';
import { grantClosure } from './grants.js';
import { loadLiveGraph } from './graph.js';
import { fullName, summaryColumns } from './people.js';

type BatchRow = typeof deletionBatches.$inferSelect;

/** Names of every person row of the tree, deleted or not: Trash labels need deleted people. */
async function nameMap(db: Queryable, treeId: string) {
  const rows = await db
    .select({
      id: persons.id,
      givenName: persons.givenName,
      middleName: persons.middleName,
      surname: persons.surname,
    })
    .from(persons)
    .where(eq(persons.treeId, treeId));
  return new Map(rows.map((r) => [r.id, fullName(r)]));
}

const names = (m: Map<string, string>, ids: (string | null)[]) =>
  ids.filter((id): id is string => id !== null && m.has(id)).map((id) => m.get(id)!);

async function rootOf(db: Queryable, b: BatchRow, m: Map<string, string>): Promise<TrashRoot> {
  if (b.rootPersonId) return { kind: 'person', name: m.get(b.rootPersonId) ?? '' };
  if (b.rootUnionId) {
    const [u] = await db.select().from(unions).where(eq(unions.id, b.rootUnionId));
    return { kind: 'union', partners: u ? names(m, [u.partnerAId, u.partnerBId]) : [] };
  }
  const [l] = await db
    .select({ childId: parentChild.childId, a: unions.partnerAId, b: unions.partnerBId })
    .from(parentChild)
    .innerJoin(unions, eq(unions.id, parentChild.unionId))
    .where(eq(parentChild.id, b.rootParentChildId!));
  return {
    kind: 'link',
    child: l ? (m.get(l.childId) ?? null) : null,
    parents: l ? names(m, [l.a, l.b]) : [],
  };
}

const count = (table: typeof persons | typeof unions | typeof parentChild) =>
  sql<number>`(select count(*)::int from ${table} where ${table.deletionBatchId} = ${deletionBatches.id})`;

async function summarise(db: Queryable, treeId: string, where: ReturnType<typeof and>) {
  const rows = await db
    .select({
      batch: deletionBatches,
      deletedBy: users.name,
      people: count(persons),
      unions: count(unions),
      links: count(parentChild),
    })
    .from(deletionBatches)
    .leftJoin(users, eq(users.id, deletionBatches.deletedByUserId))
    .where(where)
    .orderBy(desc(deletionBatches.createdAt));
  const m = await nameMap(db, treeId);
  const out: TrashBatch[] = [];
  for (const r of rows) {
    out.push({
      id: r.batch.id,
      mode: r.batch.mode,
      createdAt: r.batch.createdAt.toISOString(),
      deletedBy: r.deletedBy,
      root: await rootOf(db, r.batch, m),
      people: r.people,
      unions: r.unions,
      links: r.links,
    });
  }
  return { rows: out, names: m };
}

const unrestored = (treeId: string) =>
  and(eq(deletionBatches.treeId, treeId), isNull(deletionBatches.restoredAt));

export async function listTrash(db: Queryable, treeId: string): Promise<TrashBatch[]> {
  return (await summarise(db, treeId, unrestored(treeId))).rows;
}

export async function trashBatchDetail(
  db: Queryable,
  treeId: string,
  batchId: string,
): Promise<TrashBatchDetail> {
  const { rows, names: m } = await summarise(
    db,
    treeId,
    and(unrestored(treeId), eq(deletionBatches.id, batchId)),
  );
  const batch = rows[0];
  if (!batch) throw notFound();
  const people = await db
    .select(summaryColumns)
    .from(persons)
    .where(eq(persons.deletionBatchId, batchId));
  const us = await db.select().from(unions).where(eq(unions.deletionBatchId, batchId));
  const ls = await db
    .select({
      id: parentChild.id,
      childId: parentChild.childId,
      a: unions.partnerAId,
      b: unions.partnerBId,
    })
    .from(parentChild)
    .innerJoin(unions, eq(unions.id, parentChild.unionId))
    .where(eq(parentChild.deletionBatchId, batchId));
  const [row] = await db
    .select({ slots: deletionBatches.slots })
    .from(deletionBatches)
    .where(eq(deletionBatches.id, batchId));
  return {
    batch,
    people,
    unions: us.map((u) => ({ id: u.id, partners: names(m, [u.partnerAId, u.partnerBId]) })),
    links: ls.map((l) => ({
      id: l.id,
      child: m.get(l.childId) ?? null,
      parents: names(m, [l.a, l.b]),
    })),
    slots: row?.slots.length ?? 0,
  };
}

/** Locks and returns an unrestored batch of this tree, or 404. The caller took lockTreeGraph first. */
async function lockBatch(tx: Tx, treeId: string, batchId: string) {
  const [b] = await tx
    .select()
    .from(deletionBatches)
    .where(and(unrestored(treeId), eq(deletionBatches.id, batchId)))
    .for('update');
  if (!b) throw notFound();
  return b;
}

const restoreConflict = () =>
  conflict('This can’t be restored because the family has changed since it was deleted');

/** All or nothing (decision 7). The caller holds lockTreeGraph and has authorised. */
export async function restoreBatch(tx: Tx, actor: AuditActor, batchId: string) {
  const { treeId } = actor;
  const b = await lockBatch(tx, treeId, batchId);
  for (const s of b.slots) {
    const [u] = await tx
      .select({ a: unions.partnerAId, b: unions.partnerBId })
      .from(unions)
      .where(and(eq(unions.treeId, treeId), eq(unions.id, s.unionId)))
      .for('update');
    if (!u) continue; // erased with another batch: nothing to put back into
    const current = s.slot === 'a' ? u.a : u.b;
    if (current === s.personId) continue;
    if (current !== null) throw restoreConflict();
    await tx
      .update(unions)
      .set(s.slot === 'a' ? { partnerAId: s.personId } : { partnerBId: s.personId })
      .where(eq(unions.id, s.unionId));
  }
  const clear = { deletedAt: null, deletionBatchId: null };
  let restored: { id: string }[];
  try {
    restored = await tx
      .update(persons)
      .set(clear)
      .where(eq(persons.deletionBatchId, b.id))
      .returning({ id: persons.id });
    await tx.update(unions).set(clear).where(eq(unions.deletionBatchId, b.id));
    await tx.update(parentChild).set(clear).where(eq(parentChild.deletionBatchId, b.id));
  } catch (err) {
    if (isUniqueViolation(err)) throw restoreConflict();
    throw err;
  }
  // A link revived here may close a loop with links added since (decision 7).
  const live = await loadLiveGraph(tx, treeId);
  if (hasCycle(live)) throw restoreConflict();
  // Reviving a union or a slot may leave two live unions of the same couple.
  const couples = new Set<string>();
  for (const u of live.unions) {
    if (u.partnerAId === null || u.partnerBId === null) continue;
    const key = [u.partnerAId, u.partnerBId].sort().join(':');
    if (couples.has(key)) throw restoreConflict();
    couples.add(key);
  }
  await tx
    .update(deletionBatches)
    .set({ restoredAt: sql`now()` })
    .where(eq(deletionBatches.id, b.id));
  await audit(tx, actor, {
    action: 'trash.restore',
    entityType: 'batch',
    entityId: b.id,
    personIds: [...new Set([...restored.map((r) => r.id), ...b.slots.map((s) => s.personId)])],
    after: { mode: b.mode, people: restored.length },
  });
}

/** Decision 8. The caller holds lockTreeGraph and has authorised. */
export async function eraseBatch(tx: Tx, actor: AuditActor, batchId: string) {
  const { treeId } = actor;
  const b = await lockBatch(tx, treeId, batchId);
  const ids = (
    await tx.select({ id: persons.id }).from(persons).where(eq(persons.deletionBatchId, b.id))
  ).map((r) => r.id);
  const unionIds = (
    await tx.select({ id: unions.id }).from(unions).where(eq(unions.deletionBatchId, b.id))
  ).map((r) => r.id);
  const linkIds = (
    await tx
      .select({ id: parentChild.id })
      .from(parentChild)
      .where(eq(parentChild.deletionBatchId, b.id))
  ).map((r) => r.id);

  if (ids.length > 0) {
    // NO ACTION FKs: unlink cards and drop invites that name these people.
    await tx
      .update(treeMembers)
      .set({ personId: null })
      .where(and(eq(treeMembers.treeId, treeId), inArray(treeMembers.personId, ids)));
    const doomedInvites = await tx
      .delete(invites)
      .where(
        and(
          eq(invites.treeId, treeId),
          or(inArray(invites.stewardAnchorPersonId, ids), inArray(invites.targetPersonId, ids)),
        ),
      )
      .returning({ id: invites.id, usedAt: invites.usedAt, revokedAt: invites.revokedAt });
    // Grants anchored on them, and every grant derived from those.
    const idSet = new Set(ids);
    const doomedGrants = await grantClosure(tx, treeId, (g) => idSet.has(g.anchorPersonId), {
      lock: true,
    });
    // Their earlier audit rows hold the erased people in before/after: drop them first, then
    // write the revoke rows (which name nobody).
    const entityIds = [...doomedInvites.map((i) => i.id), ...doomedGrants.map((g) => g.id)];
    if (entityIds.length > 0) {
      await tx
        .delete(auditLog)
        .where(and(eq(auditLog.treeId, treeId), inArray(auditLog.entityId, entityIds)));
    }
    for (const inv of doomedInvites) {
      // Only invites that were still open get a revoke row.
      if (inv.usedAt !== null || inv.revokedAt !== null) continue;
      await audit(tx, actor, {
        action: 'invite.revoke',
        entityType: 'invite',
        entityId: inv.id,
        after: { reason: 'erased' },
      });
    }
    for (const g of doomedGrants) {
      await audit(tx, actor, {
        action: 'steward.revoke',
        entityType: 'grant',
        entityId: g.id,
        before: { userId: g.userId },
        after: { reason: 'erased' },
      });
    }
    if (doomedGrants.length > 0) {
      await tx.delete(branchStewards).where(
        inArray(
          branchStewards.id,
          doomedGrants.map((g) => g.id),
        ),
      );
    }
  }

  if (ids.length > 0) {
    // Unions outside this batch that still hold an erased person next to someone else (for
    // example a union restored from another batch): empty that slot, or the partner FK's
    // ON DELETE CASCADE would destroy a union that may be live. A union whose only partner is
    // erased goes with them.
    const outside = await tx
      .select({
        id: unions.id,
        a: unions.partnerAId,
        b: unions.partnerBId,
        batch: unions.deletionBatchId,
      })
      .from(unions)
      .where(
        and(
          eq(unions.treeId, treeId),
          or(inArray(unions.partnerAId, ids), inArray(unions.partnerBId, ids)),
        ),
      );
    const erasedSet = new Set(ids);
    for (const u of outside) {
      if (u.batch === b.id) continue;
      const aGone = u.a !== null && erasedSet.has(u.a);
      const bGone = u.b !== null && erasedSet.has(u.b);
      if (aGone && !bGone && u.b !== null)
        await tx.update(unions).set({ partnerAId: null }).where(eq(unions.id, u.id));
      if (bGone && !aGone && u.a !== null)
        await tx.update(unions).set({ partnerBId: null }).where(eq(unions.id, u.id));
    }
  }

  await tx.delete(parentChild).where(eq(parentChild.deletionBatchId, b.id));
  await tx.delete(unions).where(eq(unions.deletionBatchId, b.id));
  // Their photos go with them (FK cascade); queue the objects first (decision 13).
  const objectKeys =
    ids.length > 0 ? await queuePhotoObjects(tx, inArray(photos.personId, ids)) : [];
  // Cascades to their residences and to rows of other batches that still point at them.
  await tx.delete(persons).where(eq(persons.deletionBatchId, b.id));

  const erased = [...ids, ...unionIds, ...linkIds];
  if (erased.length > 0) {
    await tx.delete(auditLog).where(
      and(
        eq(auditLog.treeId, treeId),
        or(
          inArray(auditLog.entityId, erased),
          // Every row that names an erased person (decision 8).
          ids.length > 0 ? arrayOverlaps(auditLog.personIds, ids) : undefined,
          // Rows that keep an id inside before/after (invite.create, steward.grant, old
          // member.join ...), whatever their action.
          ids.length > 0
            ? sql`exists (select 1 from unnest(array[${sql.join(
                ids.map((i) => sql`${i}`),
                sql`, `,
              )}]::text[]) x
                where ${auditLog.before}::text like '%' || x || '%'
                   or ${auditLog.after}::text like '%' || x || '%')`
            : undefined,
        ),
      ),
    );
  }
  await tx.delete(deletionBatches).where(eq(deletionBatches.id, b.id));
  await audit(tx, actor, {
    action: 'trash.erase',
    entityType: 'batch',
    entityId: b.id,
    after: { mode: b.mode, people: ids.length, unions: unionIds.length, links: linkIds.length },
  });
  return objectKeys;
}
