import { eq } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { branchStewards } from '../db/schema.js';

export interface GrantRow {
  id: string;
  userId: string;
  anchorPersonId: string;
  parentGrantId: string | null;
}

/** The tree's grants matching `isRoot`, plus every grant derived from them (parent chain). */
export async function grantClosure(
  db: Queryable,
  treeId: string,
  isRoot: (g: GrantRow) => boolean,
): Promise<GrantRow[]> {
  const all: GrantRow[] = await db
    .select({
      id: branchStewards.id,
      userId: branchStewards.userId,
      anchorPersonId: branchStewards.anchorPersonId,
      parentGrantId: branchStewards.parentGrantId,
    })
    .from(branchStewards)
    .where(eq(branchStewards.treeId, treeId));
  const gone = new Set(all.filter(isRoot).map((g) => g.id));
  for (let grew = true; grew;) {
    grew = false;
    for (const g of all) {
      if (g.parentGrantId && gone.has(g.parentGrantId) && !gone.has(g.id)) {
        gone.add(g.id);
        grew = true;
      }
    }
  }
  return all.filter((g) => gone.has(g.id));
}
