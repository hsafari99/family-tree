import { type FuzzyDate, sortYear } from '@family-tree/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { parentChild, persons, residences, treeMembers, trees, unions } from './schema.js';

export const SEED_TREE_NAME = 'Sample family (seed)';

type NewPerson = Omit<typeof persons.$inferInsert, 'treeId' | 'birthSortYear' | 'deathSortYear'>;
type UnionStatus = NonNullable<(typeof unions.$inferInsert)['status']>;
type ChildKind = NonNullable<(typeof parentChild.$inferInsert)['kind']>;

const year = (y: number, qualifier: FuzzyDate['qualifier'] = 'exact'): FuzzyDate => ({
  qualifier,
  date1: String(y).padStart(4, '0'),
});

export async function seedSampleFamily(
  db: Db,
  { ownerUserId }: { ownerUserId?: string } = {},
): Promise<{ treeId: string; rootPersonId: string }> {
  return db.transaction(async (tx) => {
    // Dev only: deletes any tree named SEED_TREE_NAME, so re-seeding replaces the sample family.
    await tx.delete(trees).where(eq(trees.name, SEED_TREE_NAME));
    const [tree] = await tx.insert(trees).values({ name: SEED_TREE_NAME }).returning();
    if (!tree) throw new Error('Failed to create seed tree');
    const treeId = tree.id;

    const person = async (p: NewPerson) => {
      const [row] = await tx
        .insert(persons)
        .values({
          ...p,
          treeId,
          ...(ownerUserId ? { createdBy: ownerUserId } : {}),
          birthSortYear: p.birthDate ? sortYear(p.birthDate) : null,
          deathSortYear: p.deathDate ? sortYear(p.deathDate) : null,
        })
        .returning();
      if (!row) throw new Error(`Failed to create ${p.givenName}`);
      return row;
    };
    const union = async (
      a: { id: string },
      b: { id: string } | null,
      status: UnionStatus,
      start?: FuzzyDate,
      end?: FuzzyDate,
    ) => {
      const [row] = await tx
        .insert(unions)
        .values({
          treeId,
          partnerAId: a.id,
          partnerBId: b?.id ?? null,
          status,
          startDate: start,
          endDate: end,
        })
        .returning();
      if (!row) throw new Error('Failed to create union');
      return row;
    };
    const child = (u: { id: string }, c: { id: string }, kind: ChildKind = 'biological') =>
      tx.insert(parentChild).values({ treeId, unionId: u.id, childId: c.id, kind });

    const robert = await person({
      givenName: 'Robert',
      surname: 'Hale',
      sex: 'male',
      isLiving: false,
      birthDate: year(1930),
      birthPlace: 'Leeds, England',
      deathDate: year(1998),
      deathPlace: 'Toronto, Canada',
      causeOfDeath: 'Heart failure',
      occupation: 'Carpenter',
    });
    const margaret = await person({
      givenName: 'Margaret',
      surname: 'Hale',
      maidenName: 'Ellis',
      sex: 'female',
      isLiving: false,
      birthDate: year(1932, 'about'),
      deathDate: year(2010),
    });
    const david = await person({
      givenName: 'David',
      surname: 'Hale',
      sex: 'male',
      birthDate: year(1958),
      siblingOrder: 1,
    });
    const susan = await person({
      givenName: 'Susan',
      surname: 'Hale',
      sex: 'female',
      birthDate: year(1961),
      siblingOrder: 2,
    });
    const anna = await person({
      givenName: 'Anna',
      surname: 'Price',
      sex: 'female',
      birthDate: year(1960),
    });
    const laura = await person({
      givenName: 'Laura',
      surname: 'Hale',
      maidenName: 'Grant',
      sex: 'female',
      birthDate: year(1962),
    });
    const emma = await person({
      givenName: 'Emma',
      surname: 'Hale',
      sex: 'female',
      birthDate: year(1985),
    });
    const mia = await person({
      givenName: 'Mia',
      surname: 'Hale',
      sex: 'female',
      birthDate: year(1990),
      siblingOrder: 1,
    });
    const leo = await person({
      givenName: 'Leo',
      surname: 'Hale',
      sex: 'male',
      birthDate: year(1994),
      siblingOrder: 2,
    });
    const noah = await person({
      givenName: 'Noah',
      surname: 'Hale',
      sex: 'male',
      birthDate: year(1988),
    });

    const grandparents = await union(robert, margaret, 'widowed', year(1955));
    const davidAnna = await union(david, anna, 'divorced', year(1983), year(1989));
    const davidLaura = await union(david, laura, 'married', year(1992));
    const susanUnknown = await union(susan, null, 'partners');

    await child(grandparents, david);
    await child(grandparents, susan);
    await child(davidAnna, emma);
    await child(davidLaura, leo);
    await child(davidLaura, mia, 'adoptive');
    await child(susanUnknown, noah);

    await tx.insert(residences).values([
      {
        treeId,
        personId: robert.id,
        place: 'Leeds, England',
        fromDate: year(1930),
        toDate: year(1960),
      },
      {
        treeId,
        personId: robert.id,
        place: 'Toronto, Canada',
        fromDate: year(1960),
        toDate: year(1998),
      },
    ]);

    await tx.update(trees).set({ rootPersonId: leo.id }).where(eq(trees.id, treeId));
    if (ownerUserId) {
      await tx
        .insert(treeMembers)
        .values({ treeId, userId: ownerUserId, role: 'owner', personId: leo.id });
    }
    return { treeId, rootPersonId: leo.id };
  });
}

export const LARGE_SEED_TREE_NAME = 'Large family (seed)';
const GIVEN = ['Ada', 'Ben', 'Cara', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lea'];
const SURNAMES = ['Hale', 'Moss', 'Reyes', 'Okafor', 'Novak', 'Sato', 'Lund', 'Price'];

/**
 * A deterministic family of `people` persons for performance checks (decision 19): one founding
 * couple, then each person in turn gets a partner (a new person) and 2–3 children, breadth
 * first, until the count is reached.
 */
export async function seedLargeFamily(
  db: Db,
  { ownerUserId, people }: { ownerUserId?: string; people: number },
): Promise<{ treeId: string; rootPersonId: string }> {
  return db.transaction(async (tx) => {
    // Replace only this user's earlier large seed (or, without an owner, an ownerless one),
    // never someone else's tree that happens to have the same name.
    const mine = ownerUserId
      ? sql`${trees.id} in (select tree_id from tree_members where user_id = ${ownerUserId} and role = 'owner')`
      : sql`not exists (select 1 from tree_members m where m.tree_id = ${trees.id})`;
    await tx.delete(trees).where(and(eq(trees.name, LARGE_SEED_TREE_NAME), mine));
    const [tree] = await tx.insert(trees).values({ name: LARGE_SEED_TREE_NAME }).returning();
    const treeId = tree!.id;
    const ps: (typeof persons.$inferInsert)[] = [];
    const us: (typeof unions.$inferInsert)[] = [];
    const pcs: (typeof parentChild.$inferInsert)[] = [];
    const add = (gen: number, surname: string) => {
      const i = ps.length;
      const birth = { qualifier: 'exact' as const, date1: String(1850 + gen * 28 + (i % 7)) };
      ps.push({
        id: crypto.randomUUID(),
        treeId,
        givenName: GIVEN[i % GIVEN.length]!,
        surname,
        birthDate: birth,
        birthSortYear: sortYear(birth),
        isLiving: gen > 3,
        ...(ownerUserId ? { createdBy: ownerUserId } : {}),
      });
      return { id: ps[i]!.id!, gen, surname };
    };
    const first = add(0, SURNAMES[0]!);
    const queue = [first];
    while (ps.length < people && queue.length > 0) {
      const p = queue.shift()!;
      const partner = add(p.gen, SURNAMES[ps.length % SURNAMES.length]!);
      const unionId = crypto.randomUUID();
      us.push({ id: unionId, treeId, partnerAId: p.id, partnerBId: partner.id });
      for (let k = 0; k < 2 + (ps.length % 2) && ps.length < people; k++) {
        const child = add(p.gen + 1, p.surname);
        pcs.push({ treeId, unionId, childId: child.id });
        queue.push(child);
      }
    }
    // Chunks keep each INSERT well under Postgres's 65,535-parameter limit.
    for (let i = 0; i < ps.length; i += 1000) await tx.insert(persons).values(ps.slice(i, i + 1000));
    for (let i = 0; i < us.length; i += 1000) await tx.insert(unions).values(us.slice(i, i + 1000));
    for (let i = 0; i < pcs.length; i += 1000) await tx.insert(parentChild).values(pcs.slice(i, i + 1000));
    await tx.update(trees).set({ rootPersonId: first.id }).where(eq(trees.id, treeId));
    if (ownerUserId) {
      await tx.insert(treeMembers).values({ treeId, userId: ownerUserId, role: 'owner', personId: first.id });
    }
    return { treeId, rootPersonId: first.id };
  });
}
