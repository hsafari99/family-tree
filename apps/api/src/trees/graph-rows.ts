import type {
  ChildKind,
  FuzzyDate,
  GraphLinkView,
  GraphUnionView,
  PersonSummary,
  Sex,
  UnionStatus,
  UnionType,
} from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { parentChild, persons, unions } from '../db/schema.js';
import { summaryColumns } from './people.js';

export type GraphPersonRow = PersonSummary & { sex: Sex; siblingOrder: number | null };
export type GraphUnionRow = Pick<GraphUnionView, 'id' | 'partnerAId' | 'partnerBId'> & {
  type: UnionType;
  status: UnionStatus;
  startDate: FuzzyDate | null;
  endDate: FuzzyDate | null;
};
export type GraphLinkRow = Pick<GraphLinkView, 'id' | 'unionId' | 'childId'> & { kind: ChildKind };
/** A LiveGraph (structurally) with the columns the canvas shows. */
export interface GraphRows {
  persons: GraphPersonRow[];
  unions: GraphUnionRow[];
  parentChild: GraphLinkRow[];
}

/**
 * The tree's live people, unions and links in one snapshot (decision 6). Same liveness rules as
 * loadLiveGraph: a partner that isn't live is an empty slot, a union without a live partner is
 * dropped, and so are links whose union or child isn't live.
 */
export function loadGraphRows(db: Db, treeId: string): Promise<GraphRows> {
  return db.transaction(
    async (tx) => {
      const people = await tx
        .select({ ...summaryColumns, sex: persons.sex, siblingOrder: persons.siblingOrder })
        .from(persons)
        .where(and(eq(persons.treeId, treeId), isNull(persons.deletedAt)));
      const live = new Set(people.map((p) => p.id));
      const liveOrNull = (id: string | null) => (id !== null && live.has(id) ? id : null);
      const rawUnions = await tx
        .select({
          id: unions.id,
          partnerAId: unions.partnerAId,
          partnerBId: unions.partnerBId,
          type: unions.type,
          status: unions.status,
          startDate: unions.startDate,
          endDate: unions.endDate,
        })
        .from(unions)
        .where(and(eq(unions.treeId, treeId), isNull(unions.deletedAt)));
      const liveUnions = rawUnions
        .map((u) => ({
          ...u,
          partnerAId: liveOrNull(u.partnerAId),
          partnerBId: liveOrNull(u.partnerBId),
        }))
        .filter((u) => u.partnerAId !== null || u.partnerBId !== null);
      const unionIds = new Set(liveUnions.map((u) => u.id));
      const links = await tx
        .select({
          id: parentChild.id,
          unionId: parentChild.unionId,
          childId: parentChild.childId,
          kind: parentChild.kind,
        })
        .from(parentChild)
        .where(and(eq(parentChild.treeId, treeId), isNull(parentChild.deletedAt)));
      return {
        persons: people,
        unions: liveUnions,
        parentChild: links.filter((l) => unionIds.has(l.unionId) && live.has(l.childId)),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
