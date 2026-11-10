import { z } from 'zod';
import { kinStepSchema } from './kinship.js';
import { PLACE_MAX } from './people.js';
import { NAME_MAX, personSummarySchema, SEXES } from './trees.js';

export const SEARCH_LIMIT = 20;
export const SEARCH_LIMIT_MAX = 50;
export const SEARCH_WORDS_MAX = 5;
export const PERSON_STATUSES = ['living', 'deceased'] as const;

const blank = (v: string | undefined) => (v === '' ? undefined : v);
// An empty field in a query string means "not given" (as in similarQuerySchema).
const year = z
  .union([
    z.literal('').transform(() => undefined),
    z.coerce.number<number | string>().int().min(1).max(9999),
  ])
  .optional();
const ordered = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined || a <= b;

/** GET /trees/:id/search (decision 18). */
export const searchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(NAME_MAX * 2)
      .optional()
      .transform(blank),
    bornFrom: year,
    bornTo: year,
    diedFrom: year,
    diedTo: year,
    place: z.string().trim().max(PLACE_MAX).optional().transform(blank),
    status: z.union([z.literal('').transform(() => undefined), z.enum(PERSON_STATUSES)]).optional(),
    branch: z.union([z.literal('').transform(() => undefined), z.uuid()]).optional(),
    limit: z.coerce
      .number<number | string>()
      .int()
      .min(1)
      .max(SEARCH_LIMIT_MAX)
      .default(SEARCH_LIMIT),
  })
  .refine(
    (v) =>
      [v.q, v.bornFrom, v.bornTo, v.diedFrom, v.diedTo, v.place, v.status, v.branch].some(
        (x) => x !== undefined,
      ),
    { message: 'Type a name or choose a filter', path: ['q'] },
  )
  .refine((v) => ordered(v.bornFrom, v.bornTo), {
    message: 'From must not be after to',
    path: ['bornTo'],
  })
  .refine((v) => ordered(v.diedFrom, v.diedTo), {
    message: 'From must not be after to',
    path: ['diedTo'],
  });
export type SearchQuery = z.input<typeof searchQuerySchema>;
export type ParsedSearchQuery = z.output<typeof searchQuerySchema>;

export const searchResultSchema = personSummarySchema.extend({
  photoThumbUrl: z.string().nullable(),
  /** From the signed-in user's own card: [] for that card, null if not connected or no card. */
  relation: z.array(kinStepSchema).nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
export const searchResponseSchema = z.object({ results: z.array(searchResultSchema) });

/** GET /trees/:id/relationship (decision 20). */
export const relationshipQuerySchema = z.object({ from: z.uuid(), to: z.uuid() });
export const relationshipPersonSchema = personSummarySchema.extend({
  sex: z.enum(SEXES),
  photoThumbUrl: z.string().nullable(),
});
export type RelationshipPerson = z.infer<typeof relationshipPersonSchema>;
export const relationshipSchema = z.object({
  /** [] for the same person, null when not connected. */
  steps: z.array(kinStepSchema).nullable(),
  /** `from`, then each step's person, in path order. */
  persons: z.array(relationshipPersonSchema),
});
export type Relationship = z.infer<typeof relationshipSchema>;
