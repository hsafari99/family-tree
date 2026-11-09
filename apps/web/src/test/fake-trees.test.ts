import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeTreesApi } from './fake-trees';

const viewerCaps = {
  editAnywhere: false,
  manageTree: false,
  invite: false,
  grantStewardship: false,
};
const id = () => crypto.randomUUID();

function viewerTree() {
  const trees = new FakeTreesApi();
  const treeId = trees.addTree({ role: 'viewer', detail: { capabilities: viewerCaps } });
  return { trees, treeId };
}

describe('FakeTreesApi refuses what the real API refuses', () => {
  it.each([
    ['updateTree', (t: FakeTreesApi, i: string) => t.updateTree(i, { name: 'x' })],
    ['deleteTree', (t: FakeTreesApi, i: string) => t.deleteTree(i)],
    ['transferOwnership', (t: FakeTreesApi, i: string) => t.transferOwnership(i, id())],
    ['createResetLink', (t: FakeTreesApi, i: string) => t.createResetLink(i, id())],
    ['listInvites', (t: FakeTreesApi, i: string) => t.listInvites(i)],
    ['createInvite', (t: FakeTreesApi, i: string) => t.createInvite(i, { role: 'viewer' })],
    [
      'grantSteward',
      (t: FakeTreesApi, i: string) => t.grantSteward(i, { userId: id(), anchorPersonId: id() }),
    ],
  ])('%s returns FORBIDDEN without the capability', async (_name, call) => {
    const { trees, treeId } = viewerTree();
    expect(await call(trees, treeId)).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: MESSAGES.forbidden },
    });
  });

  it('restoreTree by a non-owner is NOT_FOUND, and respects the quota', async () => {
    const trees = new FakeTreesApi();
    const mine = trees.addTree({ role: 'owner' });
    const theirs = trees.addTree({ role: 'editor' });
    await trees.deleteTree(mine);
    trees.deletedTrees.set(theirs, {
      id: theirs,
      name: 'x',
      deletedAt: '',
      restoreUntil: '',
      role: 'editor',
      tree: trees.trees.get(theirs)!,
    });
    trees.trees.delete(theirs);
    const res = await trees.restoreTree(theirs);
    expect(res).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    trees.quotaLeft = 0;
    expect(await trees.restoreTree(mine)).toMatchObject({
      ok: false,
      error: { code: 'QUOTA_EXCEEDED', message: MESSAGES.quota },
    });
  });

  it('createTree needs two-step verification', async () => {
    const trees = new FakeTreesApi();
    trees.twoFactorEnabled = false;
    expect(await trees.createTree({ name: 'x', person: { givenName: 'a' } })).toMatchObject({
      ok: false,
      error: { code: 'TWO_FACTOR_REQUIRED', message: MESSAGES.twoFactorRequired },
    });
  });

  it('changeRole and removeMember need permission over that member', async () => {
    const { trees, treeId } = viewerTree();
    const userId = id();
    trees.trees.get(treeId)!.members.push({
      userId,
      name: 'X',
      role: 'viewer',
      personId: null,
      invitedByUserId: null,
    });
    const forbidden = { ok: false, error: { code: 'FORBIDDEN', message: MESSAGES.forbidden } };
    expect(await trees.changeRole(treeId, userId, 'editor')).toEqual(forbidden);
    expect(await trees.removeMember(treeId, userId)).toEqual(forbidden);
  });

  it('transferOwnership rejects a target without two-step verification', async () => {
    const trees = new FakeTreesApi();
    const treeId = trees.addTree();
    const userId = id();
    trees.trees.get(treeId)!.members.push({
      userId,
      name: 'X',
      role: 'editor',
      personId: null,
      invitedByUserId: null,
      twoFactorEnabled: false,
    });
    expect(await trees.transferOwnership(treeId, userId)).toMatchObject({
      ok: false,
      error: { code: 'TWO_FACTOR_REQUIRED', message: MESSAGES.twoFactorRequired },
    });
  });
});
