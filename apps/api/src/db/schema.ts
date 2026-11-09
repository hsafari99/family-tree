import type { FuzzyDate } from '@family-tree/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const sexEnum = pgEnum('sex', ['female', 'male', 'other', 'unknown']);
export const unionTypeEnum = pgEnum('union_type', ['marriage', 'partnership']);
export const unionStatusEnum = pgEnum('union_status', [
  'married',
  'partners',
  'divorced',
  'separated',
  'widowed',
]);
export const parentChildKindEnum = pgEnum('parent_child_kind', [
  'biological',
  'adoptive',
  'step',
  'foster',
]);

const id = () => uuid('id').primaryKey().defaultRandom();
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
const fuzzyDate = (name: string) => jsonb(name).$type<FuzzyDate>();

export const trees = pgTable('trees', {
  id: id(),
  name: text('name').notNull(),
  rootPersonId: uuid('root_person_id').references((): AnyPgColumn => persons.id),
  ...timestamps(),
});

export const persons = pgTable(
  'persons',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    givenName: text('given_name').notNull(),
    middleName: text('middle_name'),
    surname: text('surname'),
    maidenName: text('maiden_name'),
    nickname: text('nickname'),
    sex: sexEnum('sex').notNull().default('unknown'),
    birthDate: fuzzyDate('birth_date'),
    birthSortYear: integer('birth_sort_year'),
    birthPlace: text('birth_place'),
    deathDate: fuzzyDate('death_date'),
    deathSortYear: integer('death_sort_year'),
    deathPlace: text('death_place'),
    causeOfDeath: text('cause_of_death'),
    isLiving: boolean('is_living').notNull().default(true),
    occupation: text('occupation'),
    education: text('education'),
    biography: text('biography'),
    notes: text('notes'),
    siblingOrder: integer('sibling_order'),
    version: integer('version').notNull().default(1),
    ...timestamps(),
  },
  (t) => [index('persons_tree_idx').on(t.treeId)],
);

export const unions = pgTable(
  'unions',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    partnerAId: uuid('partner_a_id').references(() => persons.id, { onDelete: 'cascade' }),
    partnerBId: uuid('partner_b_id').references(() => persons.id, { onDelete: 'cascade' }),
    type: unionTypeEnum('type').notNull().default('marriage'),
    status: unionStatusEnum('status').notNull().default('married'),
    startDate: fuzzyDate('start_date'),
    endDate: fuzzyDate('end_date'),
    ...timestamps(),
  },
  (t) => [
    check('unions_has_partner', sql`${t.partnerAId} is not null or ${t.partnerBId} is not null`),
    index('unions_tree_idx').on(t.treeId),
    index('unions_partner_a_idx').on(t.partnerAId),
    index('unions_partner_b_idx').on(t.partnerBId),
  ],
);

export const parentChild = pgTable(
  'parent_child',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    unionId: uuid('union_id')
      .notNull()
      .references(() => unions.id, { onDelete: 'cascade' }),
    childId: uuid('child_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    kind: parentChildKindEnum('kind').notNull().default('biological'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('parent_child_union_child_uq').on(t.unionId, t.childId),
    index('parent_child_child_idx').on(t.childId),
  ],
);

export const residences = pgTable(
  'residences',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    place: text('place').notNull(),
    fromDate: fuzzyDate('from_date'),
    toDate: fuzzyDate('to_date'),
    ...timestamps(),
  },
  (t) => [index('residences_person_idx').on(t.personId)],
);
