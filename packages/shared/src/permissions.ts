export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Roles an invite or a role change can give; ownership only moves by transfer. */
export const INVITE_ROLES = ['editor', 'viewer'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** Redeeming an invite only ever raises a member's role (spec §5). */
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/** A deleted tree can be restored for this many days, then it is purged (spec §4). */
export const TREE_RESTORE_DAYS = 30;

/** Invite links expire after this many days (spec §5). */
export const INVITE_TTL_DAYS = 7;
