import { z } from 'zod';
import { fuzzyDateSchema } from './fuzzy-date.js';
import { CHILD_KINDS, UNION_STATUSES, UNION_TYPES } from './people.js';
import { SEXES } from './trees.js';

/** `tree.json` in the export ZIP (spec §7 + Phase 7 decision 2): the live tree, nothing else. */
export const EXPORT_FORMAT = 'family-tree-export';
export const EXPORT_VERSION = 1;
/**
 * The writer has no ZIP64 (decision 7): above this many stored photo bytes (an upper bound: full
 * plus thumbnail) the export is refused instead of failing half-way.
 */
export const EXPORT_MAX_PHOTO_BYTES = 3_500_000_000;

const text = z.string().nullable();
const date = fuzzyDateSchema.nullable();

// Strict everywhere: a loader that leaks a column (an email, createdBy, a storage key) fails.

export const exportDataSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  tree: z.strictObject({ id: z.uuid(), name: z.string(), rootPersonId: z.uuid().nullable() }),
  persons: z.array(
    z.strictObject({
      id: z.uuid(),
      givenName: z.string(),
      middleName: text,
      surname: text,
      maidenName: text,
      nickname: text,
      sex: z.enum(SEXES),
      birthDate: date,
      birthPlace: text,
      deathDate: date,
      deathPlace: text,
      causeOfDeath: text,
      isLiving: z.boolean(),
      occupation: text,
      education: text,
      biography: text,
      notes: text,
      siblingOrder: z.number().int().nullable(),
    }),
  ),
  unions: z.array(
    z.strictObject({
      id: z.uuid(),
      partnerAId: z.uuid().nullable(),
      partnerBId: z.uuid().nullable(),
      type: z.enum(UNION_TYPES),
      status: z.enum(UNION_STATUSES),
      startDate: date,
      endDate: date,
      /** Siblings whose parents are unknown: no partners on purpose (brief #11). */
      parentsUnknown: z.boolean(),
      /** Each partner's saved position for this union among their partners (brief #16). */
      partnerAOrder: z.number().int().nullable(),
      partnerBOrder: z.number().int().nullable(),
    }),
  ),
  parentChild: z.array(
    z.strictObject({
      id: z.uuid(),
      unionId: z.uuid(),
      childId: z.uuid(),
      kind: z.enum(CHILD_KINDS),
    }),
  ),
  residences: z.array(
    z.strictObject({
      id: z.uuid(),
      personId: z.uuid(),
      place: z.string(),
      fromDate: date,
      toDate: date,
    }),
  ),
  photos: z.array(
    z.strictObject({
      id: z.uuid(),
      personId: z.uuid(),
      /** Path inside the ZIP, or null when the stored object was missing at export time. */
      file: z.string().nullable(),
      width: z.number().int(),
      height: z.number().int(),
      isPrimary: z.boolean(),
    }),
  ),
});
export type ExportData = z.infer<typeof exportDataSchema>;
export type ExportPerson = ExportData['persons'][number];
