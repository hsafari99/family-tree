import { z } from 'zod';
import { pastFuzzyDateSchema } from './fuzzy-date.js';
import { INVITE_ROLES, ROLES } from './permissions.js';

export const SEXES = ['female', 'male', 'other', 'unknown'] as const;
export type Sex = (typeof SEXES)[number];

export const NAME_MAX = 100;

const requiredText = (message: string) =>
  z.string().trim().min(1, message).max(NAME_MAX, `Use at most ${NAME_MAX} characters`);
/** Optional text: blank becomes undefined. */
const optionalText = z
  .string()
  .trim()
  .max(NAME_MAX, `Use at most ${NAME_MAX} characters`)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const treeNameSchema = requiredText('Enter a name for the tree');

export const quickPersonSchema = z
  .object({
    givenName: requiredText('Enter a first name'),
    surname: optionalText,
    sex: z.enum(SEXES).default('unknown'),
    /** Older clients; `birthDate` replaces it (UX round 1, #4). */
    birthYear: z
      .number()
      .int('Enter a whole year')
      .min(1, 'Enter a real year')
      .refine((y) => y <= new Date().getUTCFullYear(), 'That year is in the future')
      .optional(),
    birthDate: pastFuzzyDateSchema.optional(),
  })
  .refine((p) => p.birthYear === undefined || p.birthDate === undefined, {
    path: ['birthDate'],
    message: 'Give a birth date or a birth year, not both',
  });
export type QuickPerson = z.infer<typeof quickPersonSchema>;

export const createTreeSchema = z.object({ name: treeNameSchema, person: quickPersonSchema });
export type CreateTreeInput = z.input<typeof createTreeSchema>;

export const updateTreeSchema = z
  .object({ name: treeNameSchema.optional(), rootPersonId: z.uuid().optional() })
  .refine((v) => v.name !== undefined || v.rootPersonId !== undefined, 'Nothing to change');
export type UpdateTreeInput = z.infer<typeof updateTreeSchema>;

export const roleSchema = z.enum(ROLES);
export const inviteRoleSchema = z.enum(INVITE_ROLES);

export const createInviteSchema = z.object({
  role: inviteRoleSchema,
  stewardAnchorPersonId: z.uuid().nullable().default(null),
  targetPersonId: z.uuid().nullable().default(null),
});
export type CreateInviteInput = z.input<typeof createInviteSchema>;

export const changeRoleSchema = z.object({ role: inviteRoleSchema });
export const transferSchema = z.object({ userId: z.uuid() });
export const grantStewardSchema = z.object({ userId: z.uuid(), anchorPersonId: z.uuid() });
export const inviteTokenSchema = z.object({ token: z.string().min(20).max(200) });

// ---- responses (dates are ISO strings) ----

export const treeSummarySchema = z.object({ id: z.uuid(), name: z.string(), role: roleSchema });
export const deletedTreeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  deletedAt: z.string(),
  restoreUntil: z.string(),
});
export const treeListSchema = z.object({
  trees: z.array(treeSummarySchema),
  deletedTrees: z.array(deletedTreeSchema),
});
export type TreeList = z.infer<typeof treeListSchema>;

export const createdTreeSchema = z.object({ tree: z.object({ id: z.uuid() }) });

export const treeDetailSchema = z.object({
  tree: z.object({ id: z.uuid(), name: z.string(), rootPersonId: z.uuid().nullable() }),
  me: z.object({
    role: roleSchema,
    personId: z.uuid().nullable(),
    steward: z.object({
      grants: z.array(z.object({ id: z.uuid(), anchorPersonId: z.uuid() })),
      /** False while the steward has no 2FA: grants exist but don't apply yet. */
      active: z.boolean(),
    }),
  }),
  capabilities: z.object({
    /** Add and edit anywhere (owner, editor). */
    editAnywhere: z.boolean(),
    /** Rename, change root, delete, transfer, reset links, export (owner). */
    manageTree: z.boolean(),
    /** Create viewer/editor invites (owner, active steward). */
    invite: z.boolean(),
    grantStewardship: z.boolean(),
  }),
});
export type TreeDetail = z.infer<typeof treeDetailSchema>;

export const personSummarySchema = z.object({
  id: z.uuid(),
  givenName: z.string(),
  middleName: z.string().nullable(),
  surname: z.string().nullable(),
  birthYear: z.number().int().nullable(),
  deathYear: z.number().int().nullable(),
  isLiving: z.boolean(),
});
export type PersonSummary = z.infer<typeof personSummarySchema>;
export const personListSchema = z.object({ persons: z.array(personSummarySchema) });

export const memberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  role: roleSchema,
  personId: z.uuid().nullable(),
  invitedByUserId: z.uuid().nullable(),
  /** Owner only. */
  email: z.string().optional(),
  /** Owner only: needed to know who can receive ownership or a reset link. */
  twoFactorEnabled: z.boolean().optional(),
});
export type Member = z.infer<typeof memberSchema>;
export const memberListSchema = z.object({ members: z.array(memberSchema) });

export const stewardGrantSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userName: z.string(),
  anchorPersonId: z.uuid(),
  grantedByUserId: z.uuid().nullable(),
  grantedByName: z.string().nullable(),
  parentGrantId: z.uuid().nullable(),
  active: z.boolean(),
});
export type StewardGrant = z.infer<typeof stewardGrantSchema>;
export const stewardListSchema = z.object({ stewards: z.array(stewardGrantSchema) });
export const createdIdSchema = z.object({ id: z.uuid() });

export const inviteSchema = z.object({
  id: z.uuid(),
  role: inviteRoleSchema,
  stewardAnchorPersonId: z.uuid().nullable(),
  targetPersonId: z.uuid().nullable(),
  createdByUserId: z.uuid(),
  createdByName: z.string(),
  expiresAt: z.string(),
});
export type Invite = z.infer<typeof inviteSchema>;
export const inviteListSchema = z.object({ invites: z.array(inviteSchema) });
export const createdInviteSchema = z.object({
  id: z.uuid(),
  token: z.string(),
  expiresAt: z.string(),
});
export type CreatedInvite = z.infer<typeof createdInviteSchema>;

export const invitePreviewSchema = z.object({
  treeName: z.string(),
  role: inviteRoleSchema,
  inviterName: z.string(),
  steward: z.boolean(),
  targetPersonName: z.string().nullable(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
export const acceptedInviteSchema = z.object({ treeId: z.uuid() });

export const resetLinkCreatedSchema = z.object({ token: z.string(), expiresAt: z.string() });
export type ResetLinkCreated = z.infer<typeof resetLinkCreatedSchema>;
