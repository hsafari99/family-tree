import { z } from 'zod';
import { AUDIT_ACTIONS } from './people.js';
import { deletedTreeSchema, roleSchema } from './trees.js';

/** How many recent changes the home page shows. */
export const ACTIVITY_LIMIT = 20;

/** GET /api/v1/home: `treeId` narrows the summary to one of the caller's trees. */
export const homeQuerySchema = z.object({ treeId: z.uuid().optional() });
export type HomeQuery = z.infer<typeof homeQuerySchema>;

/** A tree card on the home page (dates are ISO strings). */
export const homeTreeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: roleSchema,
  /** People in the tree, not counting the Trash. */
  peopleCount: z.number().int().nonnegative(),
  /** The last change to the tree's people or relations (or the tree itself). */
  updatedAt: z.string(),
  /** Open invite links the caller can see (owner: all; active steward: their own); else null. */
  openInvites: z.number().int().nonnegative().nullable(),
});
export type HomeTree = z.infer<typeof homeTreeSchema>;

/** One recent change, as a tree's members see it in a person's History (decision 13). */
export const activityEntrySchema = z.object({
  id: z.uuid(),
  treeId: z.uuid(),
  treeName: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  at: z.string(),
  /** Who made the change; null for a former member. */
  by: z.string().nullable(),
  /** The (live) person the change concerns. */
  person: z.object({ id: z.uuid(), name: z.string() }),
});
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const homeSummarySchema = z.object({
  trees: z.array(homeTreeSchema),
  deletedTrees: z.array(deletedTreeSchema),
  activity: z.array(activityEntrySchema),
});
export type HomeSummary = z.infer<typeof homeSummarySchema>;
