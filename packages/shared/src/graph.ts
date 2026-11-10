import { z } from 'zod';
import { fuzzyDateSchema } from './fuzzy-date.js';
import { CHILD_KINDS, UNION_STATUSES, UNION_TYPES } from './people.js';
import { NAME_MAX, personSummarySchema, SEXES } from './trees.js';

export const GRAPH_DEPTH_MAX = 3;
/** Spec §6: above this many people the full view loads by branch. */
export const FULL_VIEW_MAX = 2000;
/** A focus view never returns more people than this, nearest first (decision 4). */
export const FOCUS_VIEW_MAX = 500;
/** Duplicate-check matches returned (decision 8). */
export const SIMILAR_LIMIT = 5;
export const GRAPH_MODES = ['focus', 'full'] as const;
export type GraphMode = (typeof GRAPH_MODES)[number];

/**
 * GET /trees/:id/graph query (decision 1). `branch` only applies to mode=full, and `focus` and
 * `depth` only to mode=focus; the others are ignored, not rejected.
 */
export const graphQuerySchema = z.object({
  mode: z.enum(GRAPH_MODES).default('focus'),
  focus: z.uuid().optional(),
  // The generic keeps the input type `number | string` (Zod 4 coerce inputs are `unknown` otherwise).
  depth: z.coerce.number<number | string>().int().min(1).max(GRAPH_DEPTH_MAX).default(1),
  branch: z.uuid().optional(),
});
export type GraphQuery = z.input<typeof graphQuerySchema>;
export type ParsedGraphQuery = z.output<typeof graphQuerySchema>;

export const graphPersonSchema = personSummarySchema.extend({
  sex: z.enum(SEXES),
  siblingOrder: z.number().int().nullable(),
  /** Has at least one recorded parent (anywhere in the tree, not just in this view). */
  hasParents: z.boolean(),
  /** A parent, child, partner or sibling is outside this view. */
  hiddenRelatives: z.boolean(),
  canAddRelative: z.boolean(),
  /** Signed URL of the primary photo's thumbnail (decision 17). */
  photoThumbUrl: z.string().nullable(),
});
export type GraphPerson = z.infer<typeof graphPersonSchema>;

export const graphUnionSchema = z.object({
  id: z.uuid(),
  /** Live partner ids; a partner outside the view is still named here (decision 3). */
  partnerAId: z.uuid().nullable(),
  partnerBId: z.uuid().nullable(),
  type: z.enum(UNION_TYPES),
  status: z.enum(UNION_STATUSES),
  startDate: fuzzyDateSchema.nullable(),
  endDate: fuzzyDateSchema.nullable(),
  /** Live children of the union in the whole tree. */
  childCount: z.number().int(),
  canEdit: z.boolean(),
});
export type GraphUnionView = z.infer<typeof graphUnionSchema>;

export const graphLinkSchema = z.object({
  id: z.uuid(),
  unionId: z.uuid(),
  childId: z.uuid(),
  kind: z.enum(CHILD_KINDS),
});
export type GraphLinkView = z.infer<typeof graphLinkSchema>;

export const treeGraphSchema = z.object({
  mode: z.enum(GRAPH_MODES),
  focusId: z.uuid().nullable(),
  branchId: z.uuid().nullable(),
  persons: z.array(graphPersonSchema),
  unions: z.array(graphUnionSchema),
  links: z.array(graphLinkSchema),
  /** Live people in the whole tree. */
  total: z.number().int(),
  /** The view hit its size limit. */
  truncated: z.boolean(),
  /** Full view of a tree above FULL_VIEW_MAX without a branch: nothing returned. */
  needsBranch: z.boolean(),
});
export type TreeGraph = z.infer<typeof treeGraphSchema>;

/** GET /trees/:id/persons/similar query (decision 8). */
export const similarQuerySchema = z.object({
  givenName: z.string().trim().min(1).max(NAME_MAX),
  surname: z
    .string()
    .trim()
    .max(NAME_MAX)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  // An empty field in a query string means "not given", like surname above.
  birthYear: z
    .union([
      z.literal('').transform(() => undefined),
      z.coerce.number<number | string>().int().min(1).max(9999),
    ])
    .optional(),
});
export type SimilarQuery = z.input<typeof similarQuerySchema>;

/** POST /trees/:id/unions/:uid/child-order: every live child of the union, in the new order. */
export const childOrderSchema = z.object({
  childIds: z
    .array(z.uuid())
    .min(2)
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length, 'List each child once'),
});

type SiblingKey = { siblingOrder: number | null; birthYear: number | null; givenName: string };
const last = (n: number | null) => n ?? Number.POSITIVE_INFINITY;
/** Left-to-right order of siblings (decision 16): sibling_order, then birth year, then name. */
export function compareSiblings(a: SiblingKey, b: SiblingKey): number {
  return (
    last(a.siblingOrder) - last(b.siblingOrder) ||
    last(a.birthYear) - last(b.birthYear) ||
    a.givenName.localeCompare(b.givenName)
  );
}
