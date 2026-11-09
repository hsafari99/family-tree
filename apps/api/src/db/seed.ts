import { type FuzzyDate, sortYear } from '@family-tree/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { parentChild, persons, residences, trees, unions } from './schema.js';

export const SEED_TREE_NAME = 'Sample family (seed)';

type NewPerson = Omit<typeof persons.$inferInsert, 'treeId' | 'birthSortYear' | 'deathSortYear'>;
type UnionStatus = NonNullable<(typeof unions.$inferInsert)['status']>;
type ChildKind = NonNullable<(typeof parentChild.$inferInsert)['kind']>;

const year = (y: number, qualifier: FuzzyDate['qualifier'] = 'exact'): FuzzyDate => ({
  qualifier,
  date1: String(y).padStart(4, '0'),
});

export async function seedSampleFamily(db: Db): Promise<{ treeId: string; rootPersonId: string }> {
  return db.transaction(async (tx) => {
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
    return { treeId, rootPersonId: leo.id };
  });
}
