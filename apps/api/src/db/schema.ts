import type { FuzzyDate } from '@family-tree/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  type PgTableExtraConfigValue,
  text,
  timestamp,
  unique,
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

// Every cross-table reference carries tree_id and targets a (tree_id, id) unique index, so the
// database itself rejects links between people, unions and residences of different trees.
export const trees = pgTable(
  'trees',
  {
    id: id(),
    name: text('name').notNull(),
    rootPersonId: uuid('root_person_id'),
    ...timestamps(),
  },
  // Explicit return type breaks the trees <-> persons type cycle.
  (t): PgTableExtraConfigValue[] => [
    // NO ACTION: the root person can't be deleted while it is the root, but a hard delete of the
    // whole tree still works because the referencing tree row goes away in the same statement.
    foreignKey({
      name: 'trees_root_person_fk',
      columns: [t.id, t.rootPersonId],
      foreignColumns: [persons.treeId, persons.id],
    }),
  ],
);

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
  (t) => [
    index('persons_tree_idx').on(t.treeId),
    // A UNIQUE constraint (not just an index) so it is created inside CREATE TABLE, before the
    // composite FKs that target it.
    unique('persons_tree_id_uq').on(t.treeId, t.id),
    index('persons_tree_birth_year_idx').on(t.treeId, t.birthSortYear),
    index('persons_tree_death_year_idx').on(t.treeId, t.deathSortYear),
  ],
);

export const unions = pgTable(
  'unions',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    partnerAId: uuid('partner_a_id'),
    partnerBId: uuid('partner_b_id'),
    type: unionTypeEnum('type').notNull().default('marriage'),
    status: unionStatusEnum('status').notNull().default('married'),
    startDate: fuzzyDate('start_date'),
    endDate: fuzzyDate('end_date'),
    ...timestamps(),
  },
  (t) => [
    check('unions_has_partner', sql`${t.partnerAId} is not null or ${t.partnerBId} is not null`),
    check(
      'unions_distinct_partners',
      sql`${t.partnerAId} is null or ${t.partnerBId} is null or ${t.partnerAId} <> ${t.partnerBId}`,
    ),
    // MATCH SIMPLE: a null partner skips the check, so single-partner unions are allowed.
    foreignKey({
      name: 'unions_partner_a_fk',
      columns: [t.treeId, t.partnerAId],
      foreignColumns: [persons.treeId, persons.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'unions_partner_b_fk',
      columns: [t.treeId, t.partnerBId],
      foreignColumns: [persons.treeId, persons.id],
    }).onDelete('cascade'),
    index('unions_tree_idx').on(t.treeId),
    unique('unions_tree_id_uq').on(t.treeId, t.id),
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
    unionId: uuid('union_id').notNull(),
    childId: uuid('child_id').notNull(),
    kind: parentChildKindEnum('kind').notNull().default('biological'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'parent_child_union_fk',
      columns: [t.treeId, t.unionId],
      foreignColumns: [unions.treeId, unions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'parent_child_child_fk',
      columns: [t.treeId, t.childId],
      foreignColumns: [persons.treeId, persons.id],
    }).onDelete('cascade'),
    // Live links only, so a soft-deleted link can be re-created.
    uniqueIndex('parent_child_union_child_uq')
      .on(t.unionId, t.childId)
      .where(sql`${t.deletedAt} is null`),
    index('parent_child_child_idx').on(t.childId),
    index('parent_child_tree_idx').on(t.treeId),
  ],
);

export const residences = pgTable(
  'residences',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').notNull(),
    place: text('place').notNull(),
    fromDate: fuzzyDate('from_date'),
    toDate: fuzzyDate('to_date'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'residences_person_fk',
      columns: [t.treeId, t.personId],
      foreignColumns: [persons.treeId, persons.id],
    }).onDelete('cascade'),
    index('residences_person_idx').on(t.personId),
    index('residences_tree_idx').on(t.treeId),
  ],
);
