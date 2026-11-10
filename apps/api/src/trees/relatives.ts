import {
  type ChildKind,
  type GraphUnion,
  type LiveGraph,
  partnersOf,
  type RelativeLink,
  type UnionStatus,
  type UnionType,
  wouldCycle,
} from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { parentChild, unions } from '../db/schema.js';
import { conflict, invalid } from '../errors.js';
import { audit, type AuditActor } from './audit.js';
import { unionFieldsOf } from './relation-rows.js';

type Spec = Pick<RelativeLink, 'as' | 'unionId' | 'kind' | 'union'>;

const parentUnionsOf = (graph: LiveGraph, childId: string) => {
  const ids = new Set(graph.parentChild.filter((l) => l.childId === childId).map((l) => l.unionId));
  return graph.unions.filter((u) => ids.has(u.id));
};
const childrenOf = (graph: LiveGraph, unionId: string) =>
  graph.parentChild.filter((l) => l.unionId === unionId).map((l) => l.childId);

/** The existing union the new link uses (decision 11), or null when a new union is needed. */
function chooseUnion(graph: LiveGraph, subjectId: string, spec: Spec): GraphUnion | null {
  switch (spec.as) {
    case 'partner':
      return null;
    case 'child': {
      if (spec.unionId) {
        const u = graph.unions.find(
          (x) => x.id === spec.unionId && partnersOf(x).includes(subjectId),
        );
        if (!u) throw invalid('unionId', 'Choose one of their relationships');
        return u;
      }
      return (
        graph.unions.find((u) => {
          const ps = partnersOf(u);
          return ps.length === 1 && ps[0] === subjectId;
        }) ?? null
      );
    }
    case 'parent': {
      const open = parentUnionsOf(graph, subjectId).filter((u) => partnersOf(u).length === 1);
      if (spec.unionId) {
        const u = open.find((x) => x.id === spec.unionId);
        if (!u) throw invalid('unionId', 'Choose parents with a missing partner');
        return u;
      }
      return open.length === 1 ? open[0]! : null;
    }
    case 'sibling': {
      const all = parentUnionsOf(graph, subjectId);
      if (all.length === 0) throw invalid('as', 'Add a parent first');
      if (spec.unionId) {
        const u = all.find((x) => x.id === spec.unionId);
        if (!u) throw invalid('unionId', 'Choose one of their sets of parents');
        return u;
      }
      if (all.length > 1) throw invalid('unionId', 'Choose which parents they share');
      return all[0]!;
    }
  }
}

/** The people a relation of this shape connects: the can() ends for person.add / relation.add. */
export function relativeEnds(graph: LiveGraph, subjectId: string, spec: Spec): string[] {
  if (!graph.persons.some((p) => p.id === subjectId)) {
    throw invalid('to', 'Choose a person in this tree');
  }
  const u = chooseUnion(graph, subjectId, spec);
  return [...new Set([subjectId, ...(u ? partnersOf(u) : [])])];
}

/**
 * Makes `relativeId` (new or existing) the spec.as of `subjectId`. The caller holds
 * lockTreeGraph, loaded `graph` inside the same transaction, and has already authorised.
 */
export async function attachRelative(
  tx: Tx,
  actor: AuditActor,
  graph: LiveGraph,
  subjectId: string,
  relativeId: string,
  spec: Spec,
): Promise<void> {
  const u = chooseUnion(graph, subjectId, spec);
  const noCycle = (parents: string[], children: string[]) => {
    if (wouldCycle(graph, parents, children)) {
      throw invalid('personId', 'That would make someone their own ancestor');
    }
  };
  switch (spec.as) {
    case 'partner': {
      const pair = [subjectId, relativeId];
      if (graph.unions.some((x) => pair.every((id) => partnersOf(x).includes(id)))) {
        throw conflict('They are already partners');
      }
      await createUnion(
        tx,
        actor,
        subjectId,
        relativeId,
        spec.union?.type ?? 'marriage',
        spec.union?.status ?? 'married',
      );
      return;
    }
    case 'child': {
      const parents = u ? partnersOf(u) : [subjectId];
      if (parents.includes(relativeId))
        throw invalid('personId', 'A parent can’t also be the child');
      noCycle(parents, [relativeId]);
      const union = u ?? (await createUnion(tx, actor, subjectId, null, 'partnership', 'partners'));
      await createLink(tx, actor, union, relativeId, spec.kind);
      return;
    }
    case 'parent': {
      if (u) {
        if (partnersOf(u).includes(relativeId)) throw conflict('They are already related this way');
        const kids = childrenOf(graph, u.id);
        noCycle([relativeId], kids);
        await fillSlot(tx, actor, u, relativeId, kids);
      } else {
        noCycle([relativeId], [subjectId]);
        const union = await createUnion(tx, actor, relativeId, null, 'partnership', 'partners');
        await createLink(tx, actor, union, subjectId, spec.kind);
      }
      return;
    }
    case 'sibling': {
      const union = u!; // chooseUnion throws when there is no parent union
      noCycle(partnersOf(union), [relativeId]);
      await createLink(tx, actor, union, relativeId, spec.kind);
    }
  }
}

async function createUnion(
  tx: Tx,
  actor: AuditActor,
  a: string,
  b: string | null,
  type: UnionType,
  status: UnionStatus,
): Promise<GraphUnion> {
  const [row] = await tx
    .insert(unions)
    .values({ treeId: actor.treeId, partnerAId: a, partnerBId: b, type, status })
    .returning();
  await audit(tx, actor, {
    action: 'union.create',
    entityType: 'union',
    entityId: row!.id,
    personIds: [a, ...(b ? [b] : [])],
    after: unionFieldsOf(row!),
  });
  return { id: row!.id, partnerAId: a, partnerBId: b };
}

async function createLink(
  tx: Tx,
  actor: AuditActor,
  union: GraphUnion,
  childId: string,
  kind: ChildKind,
) {
  const [row] = await tx
    .insert(parentChild)
    .values({ treeId: actor.treeId, unionId: union.id, childId, kind })
    .onConflictDoNothing()
    .returning({ id: parentChild.id });
  if (!row) throw conflict('They are already related this way');
  await audit(tx, actor, {
    action: 'link.create',
    entityType: 'link',
    entityId: row.id,
    personIds: [childId, ...partnersOf(union)],
    after: { unionId: union.id, childId, kind },
  });
}

/** Puts `personId` into the union's empty slot; CONFLICT if someone filled it meanwhile. */
async function fillSlot(
  tx: Tx,
  actor: AuditActor,
  u: GraphUnion,
  personId: string,
  children: string[],
) {
  const slot = u.partnerAId === null ? 'partnerAId' : 'partnerBId';
  const [row] = await tx
    .update(unions)
    .set(slot === 'partnerAId' ? { partnerAId: personId } : { partnerBId: personId })
    .where(and(eq(unions.id, u.id), isNull(unions[slot]), isNull(unions.deletedAt)))
    .returning();
  if (!row) throw conflict('Those parents changed; reload and try again');
  await audit(tx, actor, {
    action: 'union.update',
    entityType: 'union',
    entityId: u.id,
    personIds: [...partnersOf(u), personId, ...children],
    before: { [slot]: null },
    after: { [slot]: personId },
  });
}
