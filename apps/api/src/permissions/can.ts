import type { InviteRole, Role } from '@family-tree/shared';

/** An effective steward grant: only loaded for stewards with 2FA (spec §4). */
export interface Grant {
  id: string;
  anchorPersonId: string;
  /** Person ids this grant covers: branch(anchor) ∩ scope of its parent grant. */
  scope: ReadonlySet<string>;
}

export interface Actor {
  userId: string;
  role: Role;
  grants: readonly Grant[];
}

type TreeTarget = { kind: 'tree' };
type RelationTarget = { kind: 'relation'; ends: readonly string[] };
type PeopleTarget = { kind: 'people'; personIds: readonly string[] };
type ReparentTarget = {
  kind: 'reparent';
  childId: string;
  fromParents: readonly string[];
  toParents: readonly string[];
};
type MemberTarget = { kind: 'member'; role: Role; invitedByUserId: string | null };

/** What each action is checked against. */
export interface Targets {
  'tree.view': TreeTarget;
  'tree.rename': TreeTarget;
  'tree.changeRoot': TreeTarget;
  'tree.delete': TreeTarget;
  'tree.restore': TreeTarget;
  'tree.transfer': TreeTarget;
  'tree.export': TreeTarget;
  'trash.view': TreeTarget;
  'trash.restore': TreeTarget;
  'trash.erase': TreeTarget;
  /** Member emails and 2FA status. */
  'members.viewDetails': TreeTarget;
  'member.resetLink': TreeTarget;
  'invites.viewAll': TreeTarget;
  /** Ends: the people the new person is attached to (empty: added unattached). */
  'person.add': RelationTarget;
  'person.edit': { kind: 'person'; personId: string };
  'relation.add': RelationTarget;
  'relation.edit': RelationTarget;
  /** Every person the delete touches: the preview's people plus the ends of ended relations. */
  'person.delete': PeopleTarget;
  /** Both ends of the relation. */
  'relation.delete': PeopleTarget;
  /**
   * Moving a child's link to another union (brief #13, decision 3). Keeping every current parent
   * needs edit scope on the old side; dropping one needs delete rights on it. The new side always
   * needs add scope.
   */
  'link.reparent': ReparentTarget;
  'invite.create': {
    kind: 'invite';
    role: InviteRole;
    stewardAnchorPersonId: string | null;
    targetPersonId: string | null;
  };
  'invite.revoke': { kind: 'ownInvite'; createdByUserId: string };
  'steward.grant': { kind: 'anchor'; personId: string };
  'steward.revoke': { kind: 'grant'; grantedByUserId: string | null };
  'member.changeRole': MemberTarget;
  'member.remove': MemberTarget;
}
export type Action = keyof Targets;

export const TREE: TreeTarget = { kind: 'tree' };

const isOwner = (a: Actor) => a.role === 'owner';
const editsAnywhere = (a: Actor) => a.role === 'owner' || a.role === 'editor';
const isSteward = (a: Actor) => a.grants.length > 0;
export const inScope = (a: Actor, personId: string) => a.grants.some((g) => g.scope.has(personId));

const ownerOnly = (a: Actor) => isOwner(a);
const addOrEdit = (a: Actor, t: RelationTarget) =>
  editsAnywhere(a) || t.ends.some((e) => inScope(a, e));
const deletePeople = (a: Actor, t: PeopleTarget) =>
  isOwner(a) || (t.personIds.length > 0 && t.personIds.every((p) => inScope(a, p)));
const manageMember = (a: Actor, t: MemberTarget) =>
  t.role !== 'owner' && (isOwner(a) || (isSteward(a) && t.invitedByUserId === a.userId));

const RULES: { [A in Action]: (actor: Actor, target: Targets[A]) => boolean } = {
  'tree.view': () => true,
  'tree.rename': ownerOnly,
  'tree.changeRoot': ownerOnly,
  'tree.delete': ownerOnly,
  'tree.restore': ownerOnly,
  'tree.transfer': ownerOnly,
  'tree.export': ownerOnly,
  'trash.view': ownerOnly,
  'trash.restore': ownerOnly,
  'trash.erase': ownerOnly,
  'members.viewDetails': ownerOnly,
  'member.resetLink': ownerOnly,
  'invites.viewAll': ownerOnly,
  'person.add': addOrEdit,
  'person.edit': (a, t) => editsAnywhere(a) || inScope(a, t.personId),
  'relation.add': addOrEdit,
  'relation.edit': addOrEdit,
  'person.delete': deletePeople,
  'relation.delete': deletePeople,
  'link.reparent': (a, t) => {
    const fromEnds = [t.childId, ...t.fromParents];
    const keepsParents = t.fromParents.every((p) => t.toParents.includes(p));
    const leave = keepsParents
      ? addOrEdit(a, { kind: 'relation', ends: fromEnds })
      : deletePeople(a, { kind: 'people', personIds: fromEnds });
    return leave && addOrEdit(a, { kind: 'relation', ends: [t.childId, ...t.toParents] });
  },
  'invite.create': (a, t) =>
    isOwner(a) ||
    (isSteward(a) &&
      (t.stewardAnchorPersonId === null || inScope(a, t.stewardAnchorPersonId)) &&
      (t.targetPersonId === null || inScope(a, t.targetPersonId))),
  'invite.revoke': (a, t) => isOwner(a) || (isSteward(a) && t.createdByUserId === a.userId),
  'steward.grant': (a, t) => isOwner(a) || inScope(a, t.personId),
  'steward.revoke': (a, t) => isOwner(a) || (isSteward(a) && t.grantedByUserId === a.userId),
  'member.changeRole': manageMember,
  'member.remove': manageMember,
};

/**
 * The single authorisation check (spec §4). Every tree route calls it; nothing relies on the UI
 * hiding buttons. Outside their branch a steward acts with their base role.
 */
export function can<A extends Action>(actor: Actor, action: A, target: Targets[A]): boolean {
  return RULES[action](actor, target);
}
