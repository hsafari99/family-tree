import type { BatchMode, DeletionPlan, DeletionSlot } from '@family-tree/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { deletionBatches, parentChild, persons, unions } from '../db/schema.js';

export async function createBatch(
  tx: Tx,
  actor: { treeId: string; userId: string },
  v: {
    mode: BatchMode;
    rootPersonId?: string;
    rootUnionId?: string;
    rootParentChildId?: string;
    slots: DeletionSlot[];
  },
): Promise<string> {
  const [row] = await tx
    .insert(deletionBatches)
    .values({
      treeId: actor.treeId,
      deletedByUserId: actor.userId,
      mode: v.mode,
      rootPersonId: v.rootPersonId ?? null,
      rootUnionId: v.rootUnionId ?? null,
      rootParentChildId: v.rootParentChildId ?? null,
      slots: v.slots,
    })
    .returning({ id: deletionBatches.id });
  return row!.id;
}

/** Soft-deletes the plan's rows into the batch and empties its partner slots. */
export async function applyPlan(tx: Tx, treeId: string, batchId: string, plan: DeletionPlan) {
  const mark = { deletedAt: sql`now()`, deletionBatchId: batchId };
  if (plan.personIds.length > 0) {
    await tx
      .update(persons)
      .set(mark)
      .where(
        and(
          eq(persons.treeId, treeId),
          inArray(persons.id, plan.personIds),
          isNull(persons.deletedAt),
        ),
      );
  }
  if (plan.unionIds.length > 0) {
    await tx
      .update(unions)
      .set(mark)
      .where(
        and(eq(unions.treeId, treeId), inArray(unions.id, plan.unionIds), isNull(unions.deletedAt)),
      );
  }
  if (plan.parentChildIds.length > 0) {
    await tx
      .update(parentChild)
      .set(mark)
      .where(
        and(
          eq(parentChild.treeId, treeId),
          inArray(parentChild.id, plan.parentChildIds),
          isNull(parentChild.deletedAt),
        ),
      );
  }
  for (const s of plan.slots) {
    await tx
      .update(unions)
      .set(s.slot === 'a' ? { partnerAId: null } : { partnerBId: null })
      .where(and(eq(unions.treeId, treeId), eq(unions.id, s.unionId)));
  }
}
