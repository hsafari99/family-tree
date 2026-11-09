import { describe, expect, it } from 'vitest';
import { type Action, type Actor, can, type Targets } from './can.js';

const IN = 'p-in';
const OUT = 'p-out';
const grant = { id: 'g1', anchorPersonId: IN, scope: new Set([IN, 'p-in-2']) };
const owner: Actor = { userId: 'owner', role: 'owner', grants: [] };
const editor: Actor = { userId: 'editor', role: 'editor', grants: [] };
const viewer: Actor = { userId: 'viewer', role: 'viewer', grants: [] };
const steward: Actor = { userId: 'steward', role: 'viewer', grants: [grant] };
const editorSteward: Actor = { userId: 'es', role: 'editor', grants: [grant] };
const TREE = { kind: 'tree' } as const;

type Row = {
  [A in Action]: [A, Targets[A], [boolean, boolean, boolean, boolean, boolean]];
}[Action];
//                                         owner   editor  viewer  steward editorSteward
const ROWS: Row[] = [
  ['tree.view', TREE, [true, true, true, true, true]],
  ['tree.rename', TREE, [true, false, false, false, false]],
  ['tree.changeRoot', TREE, [true, false, false, false, false]],
  ['tree.delete', TREE, [true, false, false, false, false]],
  ['tree.restore', TREE, [true, false, false, false, false]],
  ['tree.transfer', TREE, [true, false, false, false, false]],
  ['tree.export', TREE, [true, false, false, false, false]],
  ['trash.view', TREE, [true, false, false, false, false]],
  ['trash.restore', TREE, [true, false, false, false, false]],
  ['trash.erase', TREE, [true, false, false, false, false]],
  ['members.viewDetails', TREE, [true, false, false, false, false]],
  ['member.resetLink', TREE, [true, false, false, false, false]],
  ['invites.viewAll', TREE, [true, false, false, false, false]],
  ['person.add', { kind: 'relation', ends: [IN] }, [true, true, false, true, true]],
  ['person.add', { kind: 'relation', ends: [OUT] }, [true, true, false, false, true]],
  ['person.add', { kind: 'relation', ends: [] }, [true, true, false, false, true]],
  ['person.edit', { kind: 'person', personId: IN }, [true, true, false, true, true]],
  ['person.edit', { kind: 'person', personId: OUT }, [true, true, false, false, true]],
  ['relation.add', { kind: 'relation', ends: [OUT, IN] }, [true, true, false, true, true]],
  ['relation.edit', { kind: 'relation', ends: [OUT] }, [true, true, false, false, true]],
  [
    'person.delete',
    { kind: 'people', personIds: [IN, 'p-in-2'] },
    [true, false, false, true, true],
  ],
  ['person.delete', { kind: 'people', personIds: [IN, OUT] }, [true, false, false, false, false]],
  ['person.delete', { kind: 'people', personIds: [] }, [true, false, false, false, false]],
  ['relation.delete', { kind: 'people', personIds: [IN, OUT] }, [true, false, false, false, false]],
  ['relation.delete', { kind: 'people', personIds: [IN] }, [true, false, false, true, true]],
  [
    'invite.create',
    { kind: 'invite', role: 'editor', stewardAnchorPersonId: null, targetPersonId: null },
    [true, false, false, true, true],
  ],
  [
    'invite.create',
    { kind: 'invite', role: 'viewer', stewardAnchorPersonId: IN, targetPersonId: null },
    [true, false, false, true, true],
  ],
  [
    'invite.create',
    { kind: 'invite', role: 'viewer', stewardAnchorPersonId: OUT, targetPersonId: null },
    [true, false, false, false, false],
  ],
  [
    'invite.create',
    { kind: 'invite', role: 'viewer', stewardAnchorPersonId: null, targetPersonId: IN },
    [true, false, false, true, true],
  ],
  [
    'invite.create',
    { kind: 'invite', role: 'viewer', stewardAnchorPersonId: null, targetPersonId: OUT },
    [true, false, false, false, false],
  ],
  ['steward.grant', { kind: 'anchor', personId: IN }, [true, false, false, true, true]],
  ['steward.grant', { kind: 'anchor', personId: OUT }, [true, false, false, false, false]],
];

const ACTORS = [owner, editor, viewer, steward, editorSteward];

describe('can: permission matrix (spec §4)', () => {
  for (const [action, target, expected] of ROWS) {
    it(`${action} ${JSON.stringify(target)}`, () => {
      expect(ACTORS.map((a) => can(a, action, target as never))).toEqual(expected);
    });
  }
});

describe('can: rules that depend on who made something', () => {
  it('invite.revoke: owner any, others only their own', () => {
    const t = { kind: 'ownInvite', createdByUserId: 'steward' } as const;
    expect(can(owner, 'invite.revoke', t)).toBe(true);
    expect(can(steward, 'invite.revoke', t)).toBe(true);
    expect(can(editorSteward, 'invite.revoke', t)).toBe(false);
    expect(can(editor, 'invite.revoke', t)).toBe(false);
  });
  it('invite.revoke: a former steward (no active grants) cannot revoke their own invite', () => {
    const former: Actor = { userId: 'steward', role: 'viewer', grants: [] };
    expect(can(former, 'invite.revoke', { kind: 'ownInvite', createdByUserId: 'steward' })).toBe(
      false,
    );
  });
  it('steward.revoke: owner any, a steward only grants they made', () => {
    const mine = { kind: 'grant', grantedByUserId: 'steward' } as const;
    const ownerMade = { kind: 'grant', grantedByUserId: 'owner' } as const;
    expect(can(owner, 'steward.revoke', ownerMade)).toBe(true);
    expect(can(steward, 'steward.revoke', mine)).toBe(true);
    expect(can(steward, 'steward.revoke', ownerMade)).toBe(false);
    // A former owner (now a plain editor after a transfer) can't revoke grants they once made.
    expect(can(editor, 'steward.revoke', { kind: 'grant', grantedByUserId: 'editor' })).toBe(false);
  });
  it('member.changeRole / member.remove: owner any non-owner; steward only people they invited', () => {
    const invitedBySteward = {
      kind: 'member',
      role: 'viewer',
      invitedByUserId: 'steward',
    } as const;
    const invitedByOwner = { kind: 'member', role: 'editor', invitedByUserId: 'owner' } as const;
    const theOwner = { kind: 'member', role: 'owner', invitedByUserId: null } as const;
    for (const action of ['member.changeRole', 'member.remove'] as const) {
      expect(can(owner, action, invitedByOwner)).toBe(true);
      expect(can(owner, action, theOwner)).toBe(false);
      expect(can(steward, action, invitedBySteward)).toBe(true);
      expect(can(steward, action, invitedByOwner)).toBe(false);
      expect(can(editor, action, invitedBySteward)).toBe(false);
      // A former steward (no grants left) no longer manages the people they invited.
      expect(can({ ...steward, grants: [] }, action, invitedBySteward)).toBe(false);
    }
  });
});
