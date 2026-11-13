import { z } from 'zod';
import { type FuzzyDate, fuzzyDateSchema, pastFuzzyDateSchema, sortYear } from './fuzzy-date.js';
import { photoSchema, photoUsageSchema } from './photos.js';
import { NAME_MAX, personSummarySchema, SEXES } from './trees.js';

export const PLACE_MAX = 200;
export const LONG_TEXT_MAX = 10_000;
export const HISTORY_LIMIT = 100;
export const RESIDENCES_MAX = 50;
/** History shows only changes to people and their relations (decision 13). */
export const HISTORY_ACTION_PREFIXES = [
  'person.',
  'union.',
  'link.',
  'residence.',
  'photo.',
  'trash.',
] as const;

export const UNION_TYPES = ['marriage', 'partnership'] as const;
export type UnionType = (typeof UNION_TYPES)[number];
export const UNION_STATUSES = ['married', 'partners', 'divorced', 'separated', 'widowed'] as const;
export type UnionStatus = (typeof UNION_STATUSES)[number];
export const CHILD_KINDS = ['biological', 'adoptive', 'step', 'foster'] as const;
export type ChildKind = (typeof CHILD_KINDS)[number];
/** What the other person becomes, relative to the subject. */
export const RELATIVE_ROLES = ['parent', 'child', 'partner', 'sibling'] as const;
export type RelativeRole = (typeof RELATIVE_ROLES)[number];
export const DELETE_MODES = ['person', 'descendants'] as const;
export type DeleteMode = (typeof DELETE_MODES)[number];
export const BATCH_MODES = ['person', 'descendants', 'relation'] as const;
export type BatchMode = (typeof BATCH_MODES)[number];

const tooLong = (max: number) => `Use at most ${max} characters`;
/** Optional text that can be cleared: blank or null becomes null, absent stays absent. */
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max, tooLong(max))
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

const personShape = {
  givenName: z.string().trim().min(1, 'Enter a first name').max(NAME_MAX, tooLong(NAME_MAX)),
  middleName: clearable(NAME_MAX),
  surname: clearable(NAME_MAX),
  maidenName: clearable(NAME_MAX),
  nickname: clearable(NAME_MAX),
  sex: z.enum(SEXES),
  birthDate: pastFuzzyDateSchema.nullable(),
  birthPlace: clearable(PLACE_MAX),
  deathDate: pastFuzzyDateSchema.nullable(),
  deathPlace: clearable(PLACE_MAX),
  causeOfDeath: clearable(PLACE_MAX),
  isLiving: z.boolean(),
  occupation: clearable(PLACE_MAX),
  education: clearable(PLACE_MAX),
  biography: clearable(LONG_TEXT_MAX),
  notes: clearable(LONG_TEXT_MAX),
};
export type PersonField = keyof typeof personShape;
/** Every editable person field; equal to the Drizzle property names of `persons`. */
export const PERSON_FIELDS = Object.keys(personShape) as PersonField[];

export interface ConsistencyFields {
  isLiving?: boolean | undefined;
  birthDate?: FuzzyDate | null | undefined;
  deathDate?: FuzzyDate | null | undefined;
  deathPlace?: string | null | undefined;
  causeOfDeath?: string | null | undefined;
}

const hasDeathDetails = (p: ConsistencyFields) =>
  Boolean(p.deathDate || p.deathPlace || p.causeOfDeath);

/** Cross-field rules (decision 15). The API also runs this on the merged record of an update. */
export function personConsistencyErrors(p: ConsistencyFields): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (p.isLiving === true && hasDeathDetails(p)) {
    errors.isLiving = ['Someone with death details can’t be marked as living'];
  }
  if (p.birthDate && p.deathDate && sortYear(p.deathDate) < sortYear(p.birthDate)) {
    errors.deathDate = ['Death can’t be before birth'];
  }
  return errors;
}

type IssueSink = { addIssue(issue: { code: 'custom'; path: string[]; message: string }): void };
const addConsistencyIssues = (p: ConsistencyFields, ctx: IssueSink) => {
  for (const [path, messages] of Object.entries(personConsistencyErrors(p))) {
    for (const message of messages) ctx.addIssue({ code: 'custom', path: [path], message });
  }
};

/** A new person. */
export const personFieldsSchema = z
  .object({
    ...personShape,
    sex: personShape.sex.default('unknown'),
    birthDate: personShape.birthDate.default(null),
    deathDate: personShape.deathDate.default(null),
    isLiving: personShape.isLiving.optional(),
  })
  .superRefine(addConsistencyIssues)
  .transform((p) => ({ ...p, isLiving: p.isLiving ?? !hasDeathDetails(p) }));
export type PersonFieldsInput = z.input<typeof personFieldsSchema>;
export type PersonFields = z.output<typeof personFieldsSchema>;

/** A change to a person: the edited version plus any fields (null clears). */
export const updatePersonSchema = z
  .object(personShape)
  .partial()
  .extend({ version: z.number().int().min(1) })
  .refine((v) => PERSON_FIELDS.some((k) => v[k] !== undefined), 'Nothing to change');
export type UpdatePersonInput = z.input<typeof updatePersonSchema>;

const unionChoice = z.object({
  type: z.enum(UNION_TYPES).optional(),
  status: z.enum(UNION_STATUSES).optional(),
});

/** How a relative is attached to a subject person (decision 11). */
export const relativeLinkSchema = z.object({
  as: z.enum(RELATIVE_ROLES),
  /**
   * child: one of the subject's unions; parent: a parent union with an empty slot, or null to
   * start a new pair of parents (brief #9); sibling: a parent union.
   */
  unionId: z.uuid().nullable().optional(),
  kind: z.enum(CHILD_KINDS).default('biological'),
  /** partner only: the new union's type and status. */
  union: unionChoice.optional(),
});
export type RelativeLink = z.output<typeof relativeLinkSchema>;

export const createPersonSchema = z
  .object({
    person: personFieldsSchema,
    /** The new person becomes `as` of `to`. */
    attach: relativeLinkSchema.extend({ to: z.uuid() }).optional(),
    /** Parent only: a second parent for the same new union, new or existing (brief #9). */
    coParent: z
      .union([z.object({ person: personFieldsSchema }), z.object({ personId: z.uuid() })])
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.coParent && v.attach?.as !== 'parent') {
      ctx.addIssue({
        code: 'custom',
        path: ['coParent'],
        message: 'A second parent needs a parent to go with',
      });
    }
  });
export type CreatePersonInput = z.input<typeof createPersonSchema>;

/** POST …/persons/:subjectId/relatives: the existing `personId` becomes `as` of the subject. */
export const addRelativeSchema = relativeLinkSchema.extend({ personId: z.uuid() });
export type AddRelativeInput = z.input<typeof addRelativeSchema>;

export const updateUnionSchema = z
  .object({
    type: z.enum(UNION_TYPES),
    status: z.enum(UNION_STATUSES),
    startDate: fuzzyDateSchema.nullable(),
    endDate: fuzzyDateSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change')
  .superRefine((v, ctx) => {
    const message = unionDatesError(v);
    if (message) ctx.addIssue({ code: 'custom', path: ['endDate'], message });
  });
export type UpdateUnionInput = z.input<typeof updateUnionSchema>;

/** End before start, compared by sort year (decision 21); the API also runs it on the merged union. */
export function unionDatesError(u: {
  startDate?: FuzzyDate | null | undefined;
  endDate?: FuzzyDate | null | undefined;
}): string | null {
  return u.startDate && u.endDate && sortYear(u.endDate) < sortYear(u.startDate)
    ? 'The end can’t be before the start'
    : null;
}

export const updateParentChildSchema = z.object({ kind: z.enum(CHILD_KINDS) });
/** POST …/parent-child/:linkId/reparent: move the child's link to another union (brief #13). */
export const reparentLinkSchema = z.object({ unionId: z.uuid() });
export type ReparentLinkInput = z.infer<typeof reparentLinkSchema>;

export const unionOrderSchema = z.object({
  /** Some or all of the person's unions, in the new order; the others keep their places (brief #16). */
  unionIds: z
    .array(z.uuid())
    .min(2)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'List each relationship once'),
});
export type UnionOrderInput = z.infer<typeof unionOrderSchema>;

export const residenceInputSchema = z.object({
  place: z.string().trim().min(1, 'Enter a place').max(PLACE_MAX, tooLong(PLACE_MAX)),
  fromDate: fuzzyDateSchema.nullable().default(null),
  toDate: fuzzyDateSchema.nullable().default(null),
});
export type ResidenceInput = z.input<typeof residenceInputSchema>;

export const deletePersonSchema = z.object({ mode: z.enum(DELETE_MODES) });

// ---- responses (dates are ISO strings) ----

const text = z.string().nullable();

export const personDetailSchema = z.object({
  id: z.uuid(),
  givenName: z.string(),
  middleName: text,
  surname: text,
  maidenName: text,
  nickname: text,
  sex: z.enum(SEXES),
  birthDate: fuzzyDateSchema.nullable(),
  birthPlace: text,
  deathDate: fuzzyDateSchema.nullable(),
  deathPlace: text,
  causeOfDeath: text,
  isLiving: z.boolean(),
  occupation: text,
  education: text,
  biography: text,
  notes: text,
  version: z.number().int(),
  createdByName: text,
  updatedAt: z.string(),
});
export type PersonDetail = z.infer<typeof personDetailSchema>;

export const residenceSchema = z.object({
  id: z.uuid(),
  place: z.string(),
  fromDate: fuzzyDateSchema.nullable(),
  toDate: fuzzyDateSchema.nullable(),
});
export type Residence = z.infer<typeof residenceSchema>;

const unionHead = z.object({
  id: z.uuid(),
  type: z.enum(UNION_TYPES),
  status: z.enum(UNION_STATUSES),
});

export const personViewSchema = z.object({
  person: personDetailSchema,
  residences: z.array(residenceSchema),
  /** Primary first, then newest. */
  photos: z.array(photoSchema),
  photoUsage: photoUsageSchema,
  relations: z.object({
    /** One entry per parent union the person is a child of. */
    parents: z.array(
      z.object({
        linkId: z.uuid(),
        kind: z.enum(CHILD_KINDS),
        union: unionHead,
        parents: z.array(personSummarySchema),
        /** Other parents this child could be moved to: live unions that share a partner with this one (brief #13). */
        moveTo: z.array(z.object({ unionId: z.uuid(), parents: z.array(personSummarySchema) })),
      }),
    ),
    /** The person's own unions, with the partner (null when unknown) and their children. */
    unions: z.array(
      unionHead.extend({
        startDate: fuzzyDateSchema.nullable(),
        endDate: fuzzyDateSchema.nullable(),
        partner: personSummarySchema.nullable(),
        children: z.array(
          z.object({ linkId: z.uuid(), kind: z.enum(CHILD_KINDS), person: personSummarySchema }),
        ),
      }),
    ),
    /** Other children of the person's parent unions. */
    siblings: z.array(
      z.object({ unionId: z.uuid(), kind: z.enum(CHILD_KINDS), person: personSummarySchema }),
    ),
  }),
  capabilities: z.object({
    edit: z.boolean(),
    addRelative: z.boolean(),
    /** May open the delete preview (owner, or steward with the person in scope). */
    delete: z.boolean(),
  }),
});
export type PersonView = z.infer<typeof personViewSchema>;

export const updatedPersonSchema = z.object({ version: z.number().int() });

export const deletePreviewSchema = z.object({
  mode: z.enum(DELETE_MODES),
  people: z.array(personSummarySchema),
  /** Unions that end (removed, or lose this partner). */
  unions: z.number().int(),
  links: z.number().int(),
  /** Touched people outside the actor's scope (0 for the owner). */
  outsideScope: z.number().int(),
  blockedByRoot: z.boolean(),
  allowed: z.boolean(),
});
export type DeletePreview = z.infer<typeof deletePreviewSchema>;
export const batchIdSchema = z.object({ batchId: z.uuid() });

export const AUDIT_ACTIONS = [
  'tree.create',
  'tree.rename',
  'tree.changeRoot',
  'tree.delete',
  'tree.restore',
  'person.create',
  'person.update',
  'person.delete',
  'union.create',
  'union.update',
  'union.delete',
  'union.swapPartners',
  'union.reorder',
  'link.create',
  'link.update',
  'link.delete',
  'link.reorder',
  'link.reparent',
  'residence.create',
  'residence.update',
  'residence.delete',
  'photo.create',
  'photo.primary',
  'photo.delete',
  'trash.restore',
  'trash.erase',
  'member.join',
  'member.role',
  'member.remove',
  'member.link',
  'ownership.transfer',
  'steward.grant',
  'steward.revoke',
  'invite.create',
  'invite.revoke',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_ENTITIES = [
  'tree',
  'person',
  'union',
  'link',
  'residence',
  'photo',
  'batch',
  'member',
  'grant',
  'invite',
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const historyEntrySchema = z.object({
  id: z.uuid(),
  action: z.enum(AUDIT_ACTIONS),
  at: z.string(),
  by: z.string().nullable(),
  changes: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export const historySchema = z.object({ entries: z.array(historyEntrySchema) });

export const trashRootSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), name: z.string() }),
  z.object({
    kind: z.literal('union'),
    partners: z.array(z.string()),
    /** Siblings with unknown parents (brief #11). */
    parentsUnknown: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('link'), child: z.string().nullable(), parents: z.array(z.string()) }),
]);
export type TrashRoot = z.infer<typeof trashRootSchema>;

export const trashBatchSchema = z.object({
  id: z.uuid(),
  mode: z.enum(BATCH_MODES),
  createdAt: z.string(),
  deletedBy: z.string().nullable(),
  root: trashRootSchema,
  people: z.number().int(),
  unions: z.number().int(),
  links: z.number().int(),
});
export type TrashBatch = z.infer<typeof trashBatchSchema>;
export const trashListSchema = z.object({ batches: z.array(trashBatchSchema) });

export const trashBatchDetailSchema = z.object({
  batch: trashBatchSchema,
  people: z.array(personSummarySchema),
  unions: z.array(
    z.object({
      id: z.uuid(),
      partners: z.array(z.string()),
      parentsUnknown: z.boolean().optional(),
    }),
  ),
  links: z.array(
    z.object({ id: z.uuid(), child: z.string().nullable(), parents: z.array(z.string()) }),
  ),
  /** Partner slots that restore puts back. */
  slots: z.number().int(),
});
export type TrashBatchDetail = z.infer<typeof trashBatchDetailSchema>;
