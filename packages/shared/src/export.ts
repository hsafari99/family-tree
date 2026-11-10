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

export const exportDataSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.iso.datetime(),
  tree: z.object({ id: z.uuid(), name: z.string(), rootPersonId: z.uuid().nullable() }),
  persons: z.array(
    z.object({
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
    z.object({
      id: z.uuid(),
      partnerAId: z.uuid().nullable(),
      partnerBId: z.uuid().nullable(),
      type: z.enum(UNION_TYPES),
      status: z.enum(UNION_STATUSES),
      startDate: date,
      endDate: date,
    }),
  ),
  parentChild: z.array(
    z.object({ id: z.uuid(), unionId: z.uuid(), childId: z.uuid(), kind: z.enum(CHILD_KINDS) }),
  ),
  residences: z.array(
    z.object({ id: z.uuid(), personId: z.uuid(), place: z.string(), fromDate: date, toDate: date }),
  ),
  photos: z.array(
    z.object({
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
