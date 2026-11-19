import { z } from 'zod';
import { treeGraphSchema } from './graph.js';
import { personViewSchema } from './people.js';

/** Tree linking (tree linking spec). A tree has at most this many pending or live links. */
export const TREE_LINKS_MAX = 10;
/** A proposal waits this long for the owners before it expires. */
export const TREE_LINK_PENDING_DAYS = 30;

export const TREE_LINK_END_REASONS = [
  'ended',
  'cancelled',
  'declined',
  'bridge_left',
  'card_unlinked',
  'tree_deleted',
  'expired',
] as const;
export type TreeLinkEndReason = (typeof TREE_LINK_END_REASONS)[number];

/** POST /trees/:id/links */
export const proposeLinkSchema = z.object({ otherTreeId: z.uuid() });
export type ProposeLink = z.infer<typeof proposeLinkSchema>;

/** One link as a member of `:treeId` sees it: "the other tree" is the far side. */
export const treeLinkSchema = z.object({
  id: z.uuid(),
  status: z.enum(['live', 'pending']),
  otherTree: z.object({ id: z.uuid(), name: z.string() }),
  /** The bridge user's name, and their card in this tree and in the other one. */
  bridge: z.object({
    userId: z.uuid(),
    name: z.string(),
    personId: z.uuid(),
    otherPersonId: z.uuid(),
  }),
  /** Live people in the other tree, not counting the bridge card. */
  otherPeopleCount: z.number().int().nonnegative(),
  /** Pending only: whether each side has accepted. */
  acceptedHere: z.boolean(),
  acceptedThere: z.boolean(),
  /** What the caller may do with it. */
  canAccept: z.boolean(),
  canEnd: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type TreeLink = z.infer<typeof treeLinkSchema>;
export const treeLinksSchema = z.object({ links: z.array(treeLinkSchema) });

/** GET /trees/:id/links/candidates: the caller's other trees where they have their own card. */
export const linkCandidateSchema = z.object({
  treeId: z.uuid(),
  name: z.string(),
  peopleCount: z.number().int().nonnegative(),
});
export type LinkCandidate = z.infer<typeof linkCandidateSchema>;
export const linkCandidatesSchema = z.object({ candidates: z.array(linkCandidateSchema) });

/** GET /trees/:id/links/:linkId/graph: the linked tree joined at the bridge (V1). */
export const linkedGraphSchema = z.object({
  linkId: z.uuid(),
  tree: z.object({ id: z.uuid(), name: z.string() }),
  /** The bridge's card in the caller's tree; the linked tree's relations hang off it. */
  bridgePersonId: z.uuid(),
  graph: treeGraphSchema,
});
export type LinkedGraph = z.infer<typeof linkedGraphSchema>;

/** GET /trees/:id/links/:linkId/persons/:personId: a view-only person panel. */
export const linkedPersonSchema = z.object({
  tree: z.object({ id: z.uuid(), name: z.string() }),
  view: personViewSchema,
});
export type LinkedPerson = z.infer<typeof linkedPersonSchema>;

/** GET /api/v1/home/link-requests: proposals waiting for the caller as an owner. */
export const linkRequestSchema = z.object({
  linkId: z.uuid(),
  treeId: z.uuid(),
  treeName: z.string(),
  otherTreeName: z.string(),
  bridgeName: z.string(),
  otherPeopleCount: z.number().int().nonnegative(),
});
export type LinkRequest = z.infer<typeof linkRequestSchema>;
export const linkRequestsSchema = z.object({ requests: z.array(linkRequestSchema) });

/**
 * A linked tree's graph rows with its bridge card replaced by the caller's own bridge card (V1):
 * the bridge person appears once, and the linked tree's unions and parent links hang off the
 * caller's card. The linked bridge card itself is dropped from `persons`.
 */
export function aliasBridge<
  R extends {
    persons?: readonly { id: string }[];
    unions: readonly { partnerAId: string | null; partnerBId: string | null }[];
    parentChild: readonly { childId: string }[];
  },
>(rows: R, linkedBridgeId: string, ownBridgeId: string): R {
  const swap = (id: string | null) => (id === linkedBridgeId ? ownBridgeId : id);
  return {
    ...rows,
    ...(rows.persons ? { persons: rows.persons.filter((p) => p.id !== linkedBridgeId) } : {}),
    unions: rows.unions.map((u) => ({
      ...u,
      partnerAId: swap(u.partnerAId),
      partnerBId: swap(u.partnerBId),
    })),
    parentChild: rows.parentChild.map((l) => ({ ...l, childId: swap(l.childId)! })),
  };
}
