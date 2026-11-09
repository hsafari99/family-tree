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

// ---------------------------------------------------------------------------------------------
// Auth. Better Auth's drizzle adapter maps by JS property name, so these must equal its field
// names exactly; SQL names stay snake_case. With generateId: 'uuid' and provider 'pg', Better
// Auth leaves id generation to the database, so every id needs defaultRandom().

const authTimestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  ...authTimestamps(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...authTimestamps(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...authTimestamps(),
  },
  (t) => [
    unique('accounts_provider_account_uq').on(t.providerId, t.accountId),
    index('accounts_user_idx').on(t.userId),
  ],
);

export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...authTimestamps(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

export const twoFactors = pgTable('two_factors', {
  id: id(),
  // Both encrypted by Better Auth with the session secret.
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  verified: boolean('verified').notNull().default(false),
  failedVerificationCount: integer('failed_verification_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
});

// One-time password-reset links issued by an owner. Only a hash of the token is stored.
// Phase 3 adds tree_id.
export const resetLinks = pgTable(
  'reset_links',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reset_links_user_idx').on(t.userId)],
);
