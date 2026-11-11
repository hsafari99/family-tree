import type { AuditAction, DeletionSlot, FuzzyDate } from '@family-tree/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  type PgTableExtraConfigValue,
  primaryKey,
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
    /** Every name, lower case without accents, for pg_trgm search (decision 18). */
    searchName: text('search_name').generatedAlwaysAs(
      sql`lower(family_unaccent(given_name || ' ' || coalesce(middle_name, '') || ' ' || coalesce(surname, '') || ' ' || coalesce(maiden_name, '') || ' ' || coalesce(nickname, '')))`,
    ),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    ...timestamps(),
    /** The Trash batch that soft-deleted this row (spec §4); null while live. */
    deletionBatchId: uuid('deletion_batch_id'),
  },
  (t) => [
    index('persons_tree_idx').on(t.treeId),
    index('persons_created_by_idx').on(t.treeId, t.createdBy),
    // A UNIQUE constraint (not just an index) so it is created inside CREATE TABLE, before the
    // composite FKs that target it.
    unique('persons_tree_id_uq').on(t.treeId, t.id),
    index('persons_tree_birth_year_idx').on(t.treeId, t.birthSortYear),
    index('persons_tree_death_year_idx').on(t.treeId, t.deathSortYear),
    // NO ACTION and composite (decision 21): a row can only name a batch of its own tree. Erase
    // deletes tagged rows before the batch; a tree delete removes both in one statement.
    foreignKey({
      name: 'persons_deletion_batch_fk',
      columns: [t.treeId, t.deletionBatchId],
      foreignColumns: [deletionBatches.treeId, deletionBatches.id],
    }),
    index('persons_deletion_batch_idx').on(t.deletionBatchId),
    index('persons_search_name_trgm_idx').using('gin', t.searchName.op('gin_trgm_ops')),
    // Expression indexes matching the accent-insensitive place filter (decision 18).
    index('persons_birth_place_trgm_idx').using(
      'gin',
      sql`lower(family_unaccent(${t.birthPlace})) gin_trgm_ops`,
    ),
    index('persons_death_place_trgm_idx').using(
      'gin',
      sql`lower(family_unaccent(${t.deathPlace})) gin_trgm_ops`,
    ),
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
    /** The Trash batch that soft-deleted this row (spec §4); null while live. */
    deletionBatchId: uuid('deletion_batch_id'),
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
    // NO ACTION and composite (decision 21): a row can only name a batch of its own tree. Erase
    // deletes tagged rows before the batch; a tree delete removes both in one statement.
    foreignKey({
      name: 'unions_deletion_batch_fk',
      columns: [t.treeId, t.deletionBatchId],
      foreignColumns: [deletionBatches.treeId, deletionBatches.id],
    }),
    index('unions_deletion_batch_idx').on(t.deletionBatchId),
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
    /** The Trash batch that soft-deleted this row (spec §4); null while live. */
    deletionBatchId: uuid('deletion_batch_id'),
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
    // NO ACTION and composite (decision 21): a row can only name a batch of its own tree. Erase
    // deletes tagged rows before the batch; a tree delete removes both in one statement.
    foreignKey({
      name: 'parent_child_deletion_batch_fk',
      columns: [t.treeId, t.deletionBatchId],
      foreignColumns: [deletionBatches.treeId, deletionBatches.id],
    }),
    index('parent_child_deletion_batch_idx').on(t.deletionBatchId),
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
    index('residences_place_trgm_idx').using(
      'gin',
      sql`lower(family_unaccent(${t.place})) gin_trgm_ops`,
    ),
  ],
);

/** Spec §3 photos (decision 9). Hidden with their person; the objects live in S3 under the keys. */
export const photos = pgTable(
  'photos',
  {
    /** Set by the API before upload: the storage keys contain it. */
    id: uuid('id').primaryKey(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').notNull(),
    storageKeyFull: text('storage_key_full').notNull(),
    storageKeyThumb: text('storage_key_thumb').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Full plus thumbnail: what counts towards the tree's quota. */
    bytes: integer('bytes').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Cascade: erasing a person (or purging the tree) drops their rows; the outbox has the keys.
    foreignKey({
      name: 'photos_person_fk',
      columns: [t.treeId, t.personId],
      foreignColumns: [persons.treeId, persons.id],
    }).onDelete('cascade'),
    uniqueIndex('photos_one_primary_uq')
      .on(t.personId)
      .where(sql`${t.isPrimary}`),
    index('photos_person_idx').on(t.personId, t.createdAt),
    index('photos_tree_idx').on(t.treeId),
    check('photos_bytes_chk', sql`${t.bytes} > 0 and ${t.width} > 0 and ${t.height} > 0`),
  ],
);

/**
 * Objects to delete from storage (decision 13): written in the transaction that drops the photo
 * rows, removed once the object is gone. No FKs: rows outlive their tree.
 */
export const storageDeletions = pgTable('storage_deletions', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastTriedAt: timestamp('last_tried_at', { withTimezone: true }),
});

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
    // One login of each kind per user: two concurrent "Connect Google" round trips can't both
    // attach an account (auth/google.ts turns the violation into a message).
    unique('accounts_user_provider_uq').on(t.userId, t.providerId),
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

// Spec §5: moving 2FA to a new phone. The new authenticator secret waits here, encrypted exactly
// like two_factors.secret, until a code from the new phone confirms it; then it replaces the real
// one in a single transaction, so 2FA is never off. One per user, tied to the session that
// started it, and only good until expires_at (10 minutes).
export const twoFactorMoves = pgTable(
  'two_factor_moves',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('two_factor_moves_session_id_idx').on(t.sessionId)],
);

// One-time password-reset links issued by an owner. Only a hash of the token is stored.
// tree_id is set when a tree owner issued the link; null for the dev CLI.
export const resetLinks = pgTable(
  'reset_links',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    treeId: uuid('tree_id').references(() => trees.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reset_links_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------------------------
// Tree access (spec §3, §4).

export const memberRoleEnum = pgEnum('member_role', ['owner', 'editor', 'viewer']);

/** The single source of truth for who may see a tree and in which role. */
export const treeMembers = pgTable(
  'tree_members',
  {
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    /** The member's own card in this tree. */
    personId: uuid('person_id'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...authTimestamps(),
  },
  (t) => [
    primaryKey({ name: 'tree_members_pk', columns: [t.treeId, t.userId] }),
    // Exactly one owner per tree.
    uniqueIndex('tree_members_one_owner_uq')
      .on(t.treeId)
      .where(sql`${t.role} = 'owner'`),
    // A person card belongs to at most one login.
    uniqueIndex('tree_members_person_uq')
      .on(t.treeId, t.personId)
      .where(sql`${t.personId} is not null`),
    // NO ACTION: persons are only soft-deleted; phase 4's permanent erase must unlink first.
    foreignKey({
      name: 'tree_members_person_fk',
      columns: [t.treeId, t.personId],
      foreignColumns: [persons.treeId, persons.id],
    }),
    index('tree_members_user_idx').on(t.userId),
  ],
);

export const branchStewards = pgTable(
  'branch_stewards',
  {
    id: id(),
    treeId: uuid('tree_id').notNull(),
    userId: uuid('user_id').notNull(),
    anchorPersonId: uuid('anchor_person_id').notNull(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** The granter's grant this one derives from; null when the owner granted it. */
    parentGrantId: uuid('parent_grant_id').references((): AnyPgColumn => branchStewards.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A grant only exists while its holder is a member; removing the member removes it.
    foreignKey({
      name: 'branch_stewards_member_fk',
      columns: [t.treeId, t.userId],
      foreignColumns: [treeMembers.treeId, treeMembers.userId],
    }).onDelete('cascade'),
    // Cascade: deleting a tree deletes persons and members in one statement, and a NO ACTION
    // check here would fire before the grants are gone. A grant is meaningless without its anchor.
    foreignKey({
      name: 'branch_stewards_anchor_fk',
      columns: [t.treeId, t.anchorPersonId],
      foreignColumns: [persons.treeId, persons.id],
    }).onDelete('cascade'),
    unique('branch_stewards_user_anchor_uq').on(t.treeId, t.userId, t.anchorPersonId),
    index('branch_stewards_parent_idx').on(t.parentGrantId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    stewardAnchorPersonId: uuid('steward_anchor_person_id'),
    targetPersonId: uuid('target_person_id'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedByUserId: uuid('used_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('invites_not_owner', sql`${t.role} <> 'owner'`),
    foreignKey({
      name: 'invites_anchor_fk',
      columns: [t.treeId, t.stewardAnchorPersonId],
      foreignColumns: [persons.treeId, persons.id],
    }),
    foreignKey({
      name: 'invites_target_fk',
      columns: [t.treeId, t.targetPersonId],
      foreignColumns: [persons.treeId, persons.id],
    }),
    index('invites_tree_idx').on(t.treeId),
  ],
);

// ---------------------------------------------------------------------------------------------
// Trash and audit (spec §3, §4, §8).

export const deletionModeEnum = pgEnum('deletion_mode', ['person', 'descendants', 'relation']);

/**
 * One delete operation. Rows it soft-deleted carry its id in deletion_batch_id; partner slots it
 * emptied are listed in `slots`. Restore and erase act on the whole batch. The root ids are plain
 * uuids (no FK): they point into the batch itself and go when it is erased.
 */
export const deletionBatches = pgTable(
  'deletion_batches',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    mode: deletionModeEnum('mode').notNull(),
    rootPersonId: uuid('root_person_id'),
    rootUnionId: uuid('root_union_id'),
    rootParentChildId: uuid('root_parent_child_id'),
    slots: jsonb('slots')
      .$type<DeletionSlot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    restoredAt: timestamp('restored_at', { withTimezone: true }),
  },
  (t) => [
    // Target of the composite deletion_batch FKs; a UNIQUE constraint so it exists inside CREATE TABLE.
    unique('deletion_batches_tree_id_uq').on(t.treeId, t.id),
    index('deletion_batches_tree_idx').on(t.treeId, t.createdAt),
    check(
      'deletion_batches_root_chk',
      sql`(${t.mode} in ('person', 'descendants') and ${t.rootPersonId} is not null
        and ${t.rootUnionId} is null and ${t.rootParentChildId} is null)
        or (${t.mode} = 'relation' and ${t.rootPersonId} is null
        and (${t.rootUnionId} is null) <> (${t.rootParentChildId} is null))`,
    ),
  ],
);

/** Every change to tree data (spec §8). person_ids: the people it concerns (a person's History). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').$type<AuditAction>().notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    personIds: uuid('person_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_tree_created_idx').on(t.treeId, t.createdAt),
    index('audit_log_person_ids_idx').using('gin', t.personIds),
    index('audit_log_entity_idx').on(t.entityId),
  ],
);
